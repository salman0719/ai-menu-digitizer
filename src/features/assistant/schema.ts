/**
 * Assistant schemas, limits and the monthly message cap (A1).
 *
 * The assistant is a signed-in, help-only surface for now: it answers
 * questions about features that exist and refuses to invent the rest. It
 * never changes data — proposals and approval belong to A2/A3.
 *
 * Limits are deliberately small. A chat turn costs real neurons on the
 * shared Workers AI free allocation (see the A0 spike), so the account cap
 * and the per-request bounds are the cost brake, not polish.
 */

import { z } from "zod";

/** A long question still fits easily; anything longer is a paste, not a chat. */
export const ASSISTANT_MAX_MESSAGE_CHARS = 1_000;

/** How many prior turns the browser may replay (bounded prompt, bounded cost). */
export const ASSISTANT_MAX_HISTORY_MESSAGES = 6;

/** A model answer that exceeds this is truncated by the provider budget anyway. */
export const ASSISTANT_MAX_REPLY_CHARS = 4_000;

/** 300 questions a month is far more than one café asks. */
export const DEFAULT_ASSISTANT_MONTHLY_CAP = 300;
export const MAX_ASSISTANT_MONTHLY_CAP = 5_000;
export const ASSISTANT_MONTHLY_CAP_ENV = "ASSISTANT_MONTHLY_MESSAGE_CAP";

/**
 * The whole product shares one Workers AI free allocation (10,000
 * neurons/day), so a single busy account must not be able to drain it.
 * Measured compact turns cost 5–11 neurons, so 500 calls ≈ half the pool.
 */
export const DEFAULT_ASSISTANT_DAILY_CEILING = 500;
export const MAX_ASSISTANT_DAILY_CEILING = 5_000;
export const ASSISTANT_DAILY_CEILING_ENV = "ASSISTANT_DAILY_CALL_CEILING";

/** Parse the configured cap, falling back to the default when unset/invalid. */
export function assistantMonthlyCap(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env[ASSISTANT_MONTHLY_CAP_ENV]);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ASSISTANT_MONTHLY_CAP;
  return Math.min(Math.trunc(parsed), MAX_ASSISTANT_MONTHLY_CAP);
}

/** Parse the configured global daily ceiling (all accounts together). */
export function assistantDailyCeiling(
  env: Record<string, string | undefined> = process.env
): number {
  const parsed = Number(env[ASSISTANT_DAILY_CEILING_ENV]);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ASSISTANT_DAILY_CEILING;
  return Math.min(Math.trunc(parsed), MAX_ASSISTANT_DAILY_CEILING);
}

/** One prior turn, as replayed by the browser. */
export const assistantHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(ASSISTANT_MAX_MESSAGE_CHARS),
});

export type AssistantHistoryMessage = z.infer<typeof assistantHistoryMessageSchema>;

export const assistantRequestSchema = z.object({
  message: z.string().trim().min(1).max(ASSISTANT_MAX_MESSAGE_CHARS),
  history: z.array(assistantHistoryMessageSchema).max(ASSISTANT_MAX_HISTORY_MESSAGES).default([]),
  /**
   * Optional target menu. With a menu the owner may get a proposal; without
   * one the assistant is the A1 help surface. Staff and signed-out callers
   * never get a proposal, whatever they send here.
   */
  menuId: z.string().trim().min(1).max(200).optional(),
});

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/** This account's assistant allowance for the current UTC month. */
export const assistantUsageSummarySchema = z.object({
  cap: z.number().int().positive(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  /** ISO timestamp of the next UTC month boundary (the reset). */
  periodEnd: z.string().min(1),
});

export type AssistantUsageSummary = z.infer<typeof assistantUsageSummarySchema>;

/**
 * The assistant half of the spend panel (A4), read from the ledger rather
 * than from an in-memory counter. Cost is null as soon as one call omitted
 * `usage.neurons`, because a partial sum would read like a complete one.
 */
export const assistantSpendSummarySchema = z.object({
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  /** Every model call this month, failed ones included: they are billed too. */
  messages: z.number().int().nonnegative(),
  cap: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  /** Sum of reported neurons; null when no call reported any. */
  neurons: z.number().nonnegative().nullable(),
  /** Micro-USD from reported neurons; null when any call omitted them. */
  costMicros: z.number().int().nonnegative().nullable(),
  /** Calls whose neuron count was missing (so their cost is unknown). */
  unpricedMessages: z.number().int().nonnegative(),
});

export type AssistantSpendSummary = z.infer<typeof assistantSpendSummarySchema>;

export const assistantReplySchema = z.object({
  reply: z.string().min(1).max(ASSISTANT_MAX_REPLY_CHARS),
  usage: assistantUsageSummarySchema,
});

export type AssistantReply = z.infer<typeof assistantReplySchema>;

/** Error codes the route may return; the browser client maps them to copy. */
export type AssistantErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "cross_origin_rejected"
  | "feature_disabled"
  | "assistant_cap_reached"
  | "assistant_budget_exhausted"
  | "assistant_not_configured"
  | "assistant_unavailable"
  | "not_found"
  | "server_db_unavailable";
