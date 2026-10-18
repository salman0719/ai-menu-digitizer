/**
 * Typed browser client for `/api/launch`. Client-safe: HTTP + Zod only.
 */

import { z } from "zod";

import { SyncError } from "@/features/menus/sync";

import { launchStatusSchema, type LaunchStatus } from "./schema";

const launchEnvelope = z.object({ launch: launchStatusSchema });

export async function fetchLaunchStatus(): Promise<LaunchStatus> {
  let response: Response;
  try {
    response = await fetch("/api/launch", { cache: "no-store" });
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
    throw new SyncError("unauthorized", "Sign in to see your checklist.");
  }
  if (!response.ok) {
    throw new SyncError("unavailable", "Could not load your checklist. Try again in a moment.");
  }

  try {
    return launchEnvelope.parse(payload).launch;
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent checklist data this app could not understand."
    );
  }
}
