/**
 * Extraction usage + the free-launch cost brake (Step 11).
 *
 * While the launch promotion makes everything free, nothing throttles spend
 * except these limits: a per-account monthly extraction cap for signed-in
 * cafés, and a per-caller hourly limit for the anonymous local-first flow
 * (identified by a hash of the caller's address — no raw IP stored).
 *
 * The summary mirrors the menu/order honesty rules: `costMicros` is null as
 * soon as one request in the period is unpriced, because a partial sum would
 * read like a complete one.
 */

import { z } from "zod";

/** 150 extractions a month is far more than a café re-digitizing its menu. */
export const DEFAULT_MONTHLY_EXTRACTION_CAP = 150;
export const MAX_MONTHLY_EXTRACTION_CAP = 5000;

/** Anonymous callers are capped per hour instead of per month. */
export const ANONYMOUS_EXTRACTION_LIMIT_PER_HOUR = 10;

export const EXTRACTION_MONTHLY_CAP_ENV = "EXTRACTION_MONTHLY_CAP";

/** Parse the configured cap, falling back to the default when unset/invalid. */
export function monthlyExtractionCap(
  env: Record<string, string | undefined> = process.env
): number {
  const parsed = Number(env[EXTRACTION_MONTHLY_CAP_ENV]);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MONTHLY_EXTRACTION_CAP;
  return Math.min(Math.trunc(parsed), MAX_MONTHLY_EXTRACTION_CAP);
}

/** The current calendar month in UTC: [start, end). */
export function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export const usageSummarySchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  /** Every attempt, failed ones included — a failed call is still billed. */
  requests: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /** Micro-USD; null when unpriced or when rates are not configured. */
  costMicros: z.number().int().nonnegative().nullable(),
  /** Requests whose cost we could not compute (no tokens or no rates). */
  unpricedRequests: z.number().int().nonnegative(),
  cap: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  ratesConfigured: z.boolean(),
});

export type UsageSummary = z.infer<typeof usageSummarySchema>;
