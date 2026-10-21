/**
 * Typed browser client for the menu availability API
 * (`/api/menus/[menuId]/availability`). Client-safe: HTTP only, no Drizzle
 * and no server repository imports.
 *
 * Shares the `SyncError` taxonomy with the other clients; responses are
 * re-validated with Zod so a malformed payload surfaces as
 * `SyncError("unavailable")` instead of a half-rendered time editor.
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";

import { menuAvailabilitySchema, type MenuAvailability } from "./schema";

const availabilityEnvelope = z.object({ availability: menuAvailabilitySchema });

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
    case "server_db_unavailable":
      return "unavailable";
    default:
      break;
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "invalid";
  return "unavailable";
}

async function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  decode: (payload: unknown) => T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
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
    return decode(payload);
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent data this app could not understand. Try again in a moment."
    );
  }
}

function availabilityUrl(menuId: string): string {
  return `/api/menus/${encodeURIComponent(menuId)}/availability`;
}

/** The menu's opening windows (`[]` = always open). Any member may read. */
export async function fetchAvailability(menuId: string): Promise<MenuAvailability> {
  return requestJson(availabilityUrl(menuId), undefined, (payload) =>
    availabilityEnvelope.parse(payload).availability
  );
}

/** Replace the opening windows (owner-only). */
export async function saveAvailability(
  menuId: string,
  windows: MenuAvailability
): Promise<MenuAvailability> {
  return requestJson(
    availabilityUrl(menuId),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ windows }),
    },
    (payload) => availabilityEnvelope.parse(payload).availability
  );
}
