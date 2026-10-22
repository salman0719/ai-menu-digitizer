/**
 * Typed browser client for the account data endpoints (Step 11).
 * Client-safe: HTTP + browser download plumbing only.
 */

import { z } from "zod";

import { SyncError } from "@/features/menus/sync";

const deleteResultSchema = z.object({
  deleted: z.boolean(),
  restaurants: z.number().int().nonnegative(),
});

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

function messageFrom(payload: unknown, fallback: string): string {
  const envelope = errorEnvelope.safeParse(payload);
  return envelope.success ? envelope.data.error.message : fallback;
}

/**
 * Download the account export as a JSON file. The server names it; if a proxy
 * strips the header we still produce a sensible name.
 */
export async function downloadAccountExport(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/account/export", { cache: "no-store" });
  } catch {
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) {
      throw new SyncError("unauthorized", "Sign in to export your data.");
    }
    throw new SyncError("unavailable", messageFrom(payload, "Could not build the export."));
  }

  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  const filename = match?.[1] ?? "eateryo-export.json";

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Permanently delete the account and the restaurants it created. */
export async function deleteAccount(): Promise<{ deleted: boolean; restaurants: number }> {
  let response: Response;
  try {
    response = await fetch("/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "delete my account" }),
    });
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
    throw new SyncError("unauthorized", "Sign in to delete your account.");
  }
  if (!response.ok) {
    throw new SyncError("unavailable", messageFrom(payload, "Could not delete the account."));
  }

  const parsed = deleteResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SyncError("unavailable", "The server sent a response this app could not read.");
  }
  return parsed.data;
}
