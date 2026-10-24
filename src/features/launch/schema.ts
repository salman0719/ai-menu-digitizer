/**
 * Launch checklist data (Step 11). The client re-validates the payload with
 * the same schema the server builds, so a half-rendered checklist is
 * impossible.
 */

import { z } from "zod";

import { assistantSpendSummarySchema } from "@/features/assistant/schema";
import { usageSummarySchema } from "@/features/usage/schema";

export const launchSnapshotSchema = z.object({
  menuCount: z.number().int().nonnegative(),
  publishedCount: z.number().int().nonnegative(),
  /** Path of the most recently published menu, when one is live. */
  livePath: z.string().min(1).nullable(),
  orderCount: z.number().int().nonnegative(),
  /** Items with no price — the review step's first signal. */
  unpricedItems: z.number().int().nonnegative(),
  /** Items the AI or the owner flagged for review. */
  reviewNotes: z.number().int().nonnegative(),
  /** Menus whose stored document failed the canonical schema (server bug). */
  unreadableMenus: z.number().int().nonnegative(),
});

export type LaunchSnapshot = z.infer<typeof launchSnapshotSchema>;

export const launchStatusSchema = launchSnapshotSchema.extend({
  usage: usageSummarySchema.nullable(),
  /** The assistant's own ledger, shown next to extraction spend (A4). */
  assistant: assistantSpendSummarySchema,
});

export type LaunchStatus = z.infer<typeof launchStatusSchema>;
