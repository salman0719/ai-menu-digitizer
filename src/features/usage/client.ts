/**
 * Typed browser client for `/api/usage` (Step 11 — spend visibility).
 * Client-safe: HTTP only, no Drizzle and no server repo imports.
 */

import { z } from "zod";

import { SyncError } from "@/features/menus/sync";

import { usageSummarySchema, type UsageSummary } from "./schema";

const usageEnvelope = z.object({ usage: usageSummarySchema });

/** This account's extraction usage for the current UTC month. */
export async function fetchUsage(): Promise<UsageSummary> {
  let response: Response;
  try {
    response = await fetch("/api/usage", { cache: "no-store" });
  } catch {
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    throw new SyncError("unauthorized", "Sign in to see your usage.");
  }
  if (!response.ok) {
    throw new SyncError("unavailable", `Could not load usage (${response.status}).`);
  }

  try {
    return usageEnvelope.parse(payload).usage;
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent usage data this app could not understand. Try again in a moment."
    );
  }
}
