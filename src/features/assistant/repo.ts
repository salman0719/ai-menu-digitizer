/**
 * Assistant usage ledger + cap accounting (A1). Server-only.
 *
 * Every attempt writes one row, successful or not, because Workers AI bills
 * for both and the cap must count what was actually spent. `usage.neurons`
 * comes straight from the provider (measured in A0), so cost is exact rather
 * than estimated from token rates.
 *
 * Reads are scoped to the verified user id and to one UTC month; the daily
 * ceiling counts every account together because the free allocation is shared
 * by the whole Cloudflare account.
 */

import { and, count, eq, gte, lt } from "drizzle-orm";

import type { TenancyDb } from "@/features/tenancy/repo";
import { monthWindow } from "@/features/usage/schema";
import { assistantUsage } from "@/lib/db/schema";
import { assistantDailyCeiling, assistantMonthlyCap, type AssistantUsageSummary } from "./schema";
import { MICRO_USD_PER_NEURON } from "@/lib/ai/assistant/worker-ai";

export interface RecordAssistantUsageInput {
  userId: string;
  requestId: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  neurons: number | null;
  latencyMs: number | null;
  status: "succeeded" | "failed";
  errorCode?: string | null;
  now?: Date;
}

/** Exact paid-equivalent cost in micro-USD; null when the provider omitted neurons. */
export function assistantCostMicros(neurons: number | null): number | null {
  if (neurons === null || !Number.isFinite(neurons) || neurons < 0) return null;
  return Math.round(neurons * MICRO_USD_PER_NEURON);
}

/** Append one attempt to the ledger. */
export async function recordAssistantUsage(
  db: TenancyDb,
  input: RecordAssistantUsageInput
): Promise<void> {
  await db.insert(assistantUsage).values({
    userId: input.userId,
    requestId: input.requestId,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    neurons: input.neurons,
    costMicros: assistantCostMicros(input.neurons),
    latencyMs: input.latencyMs,
    status: input.status,
    errorCode: input.errorCode ?? null,
    createdAt: input.now ?? new Date(),
  });
}

/** Messages this account has already spent in the current UTC month. */
export async function countAssistantMessagesThisMonth(
  db: TenancyDb,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const { start, end } = monthWindow(now);
  const rows = await db
    .select({ value: count() })
    .from(assistantUsage)
    .where(
      and(
        eq(assistantUsage.userId, userId),
        gte(assistantUsage.createdAt, start),
        lt(assistantUsage.createdAt, end)
      )
    );
  return Number(rows[0]?.value ?? 0);
}

/** Model calls made by every account since 00:00 UTC (the shared budget). */
export async function countAssistantCallsToday(
  db: TenancyDb,
  now: Date = new Date()
): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db
    .select({ value: count() })
    .from(assistantUsage)
    .where(gte(assistantUsage.createdAt, start));
  return Number(rows[0]?.value ?? 0);
}

/** This month's allowance for one account, with the cap and the reset date. */
export async function getAssistantUsageSummary(
  db: TenancyDb,
  userId: string,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<AssistantUsageSummary> {
  const used = await countAssistantMessagesThisMonth(db, userId, now);
  const cap = assistantMonthlyCap(env);
  const { end } = monthWindow(now);
  return {
    cap,
    used,
    remaining: Math.max(0, cap - used),
    periodEnd: end.toISOString(),
  };
}

/** Both brakes in one place so the route cannot check only one of them. */
export interface AssistantAllowance {
  monthlyCap: number;
  monthlyUsed: number;
  dailyCeiling: number;
  dailyCalls: number;
  summary: AssistantUsageSummary;
}

export async function readAssistantAllowance(
  db: TenancyDb,
  userId: string,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<AssistantAllowance> {
  const [summary, dailyCalls] = await Promise.all([
    getAssistantUsageSummary(db, userId, now, env),
    countAssistantCallsToday(db, now),
  ]);
  return {
    monthlyCap: summary.cap,
    monthlyUsed: summary.used,
    dailyCeiling: assistantDailyCeiling(env),
    dailyCalls,
    summary,
  };
}
