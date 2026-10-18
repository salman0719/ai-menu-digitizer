/**
 * Usage repository — the ledger behind the cost brake and the spend panel.
 *
 * Every extraction attempt writes one row, successful or not, because the
 * provider bills for both. Rows are inserted from the request path with the
 * request id, so a log line, an alert, and a usage row all refer to the same
 * call.
 *
 * Reads are scoped to the verified user id (never a client-supplied id) and
 * to one UTC calendar month.
 */

import { and, count, desc, eq, gte, lt } from "drizzle-orm";

import type { ProviderUsage } from "@/lib/ai/provider";
import { extractionUsage } from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";

import { costMicros, tokenRatesFromEnv, type TokenRates } from "./pricing";
import { monthWindow, monthlyExtractionCap, type UsageSummary } from "./schema";

/** A month of a busy café is a few dozen rows; stop reading far beyond that. */
export const MAX_USAGE_ROWS_SCANNED = 2000;

export interface RecordExtractionUsageInput {
  /** Null for the anonymous local-first flow. */
  userId: string | null;
  /** Hashed caller address for anonymous extraction; null when signed in. */
  callerHash: string | null;
  requestId: string;
  model: string;
  pages: number;
  imageBytes: number;
  usage: ProviderUsage | null;
  status: "succeeded" | "failed";
  errorCode?: string | null;
  /** Overrides for tests; production reads the env rates. */
  rates?: TokenRates | null;
  now?: Date;
}

/** Append one attempt to the ledger. */
export async function recordExtractionUsage(
  db: TenancyDb,
  input: RecordExtractionUsageInput
): Promise<void> {
  const rates = input.rates === undefined ? tokenRatesFromEnv() : input.rates;
  const usage = input.usage;
  await db.insert(extractionUsage).values({
    userId: input.userId,
    callerHash: input.callerHash,
    requestId: input.requestId,
    model: input.model,
    pages: input.pages,
    imageBytes: input.imageBytes,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    costMicros: usage ? costMicros(usage, rates) : null,
    status: input.status,
    errorCode: input.errorCode ?? null,
    createdAt: input.now ?? new Date(),
  });
}

/**
 * This month's usage for one account, with the cap and what remains.
 * Aggregation happens in code so the "partial cost is not a cost" rule can be
 * expressed exactly instead of as a SQL SUM that hides nulls.
 */
export async function getMonthlyUsageSummary(
  db: TenancyDb,
  userId: string,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<UsageSummary> {
  const { start, end } = monthWindow(now);
  const rows = await db
    .select({
      status: extractionUsage.status,
      pages: extractionUsage.pages,
      inputTokens: extractionUsage.inputTokens,
      outputTokens: extractionUsage.outputTokens,
      costMicros: extractionUsage.costMicros,
    })
    .from(extractionUsage)
    .where(
      and(
        eq(extractionUsage.userId, userId),
        gte(extractionUsage.createdAt, start),
        lt(extractionUsage.createdAt, end)
      )
    )
    .orderBy(desc(extractionUsage.createdAt))
    .limit(MAX_USAGE_ROWS_SCANNED);

  const rates = tokenRatesFromEnv(env);
  let succeeded = 0;
  let failed = 0;
  let pages = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let sawInput = false;
  let sawOutput = false;
  let costTotal = 0;
  let unpriced = 0;

  for (const row of rows) {
    if (row.status === "succeeded") succeeded += 1;
    else failed += 1;
    pages += row.pages;
    if (row.inputTokens !== null) {
      inputTokens += row.inputTokens;
      sawInput = true;
    }
    if (row.outputTokens !== null) {
      outputTokens += row.outputTokens;
      sawOutput = true;
    }
    if (row.costMicros === null) {
      unpriced += 1;
    } else {
      costTotal += row.costMicros;
    }
  }

  const cap = monthlyExtractionCap(env);
  const requests = rows.length;
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    requests,
    succeeded,
    failed,
    pages,
    inputTokens: sawInput ? inputTokens : null,
    outputTokens: sawOutput ? outputTokens : null,
    // Empty month + configured rates = a real $0.00; otherwise any unpriced
    // row makes the total unknown rather than a misleading partial sum.
    costMicros: rates === null || unpriced > 0 ? null : costTotal,
    unpricedRequests: rates === null ? requests : unpriced,
    cap,
    remaining: Math.max(0, cap - requests),
    ratesConfigured: rates !== null,
  };
}

/** How many times this anonymous caller extracted since `since`. */
export async function countAnonymousExtractions(
  db: TenancyDb,
  callerHash: string,
  since: Date
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(extractionUsage)
    .where(
      and(eq(extractionUsage.callerHash, callerHash), gte(extractionUsage.createdAt, since))
    );
  return Number(rows[0]?.value ?? 0);
}
