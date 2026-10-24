/**
 * Typed browser client for the one-submit publish setup route.
 * Client-safe: HTTP only, no Drizzle or server imports.
 *
 * Shares the `SyncError` taxonomy with the menu, restaurant and publication
 * clients so the wizard handles one error shape across the whole flow.
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";

import {
  publishSetupResultSchema,
  type PublishSetupInput,
  type PublishSetupResult,
} from "./setup-schema";

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

function mapErrorCode(code: string, status: number): SyncErrorCode {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "forbidden":
      return "forbidden";
    case "not_found":
      return "not_found";
    case "invalid_body":
      return "invalid";
    case "slug_taken":
      return "slug_taken";
    case "not_published":
      return "not_published";
    case "server_db_unavailable":
      return "unavailable";
    default:
      break;
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "slug_taken";
  if (status === 400) return "invalid";
  return "unavailable";
}

/**
 * Publish a draft in one submit. The server creates the restaurant only
 * when the account has none, attaches the menu when needed, and returns the
 * live link. Retrying the same call is safe.
 */
export async function publishMenuWithSetup(
  menuId: string,
  input: PublishSetupInput
): Promise<PublishSetupResult> {
  let response: Response;
  try {
    response = await fetch(`/api/menus/${encodeURIComponent(menuId)}/publish-setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
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

  if (!response.ok) {
    const envelope = errorEnvelope.safeParse(payload);
    if (envelope.success) {
      throw new SyncError(
        mapErrorCode(envelope.data.error.code, response.status),
        envelope.data.error.message
      );
    }
    throw new SyncError("unavailable", `The server responded ${response.status}.`);
  }

  try {
    return publishSetupResultSchema.parse(payload);
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent data this app could not understand. Try again in a moment."
    );
  }
}
