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

import { isTimeZone, menuAvailabilitySchema, type MenuAvailability } from "./schema";

/** A menu's opening windows plus the zone those wall times are written in. */
export interface AvailabilitySettings {
  availability: MenuAvailability;
  /** The restaurant's IANA zone, or null when it has never saved one (UTC). */
  timeZone: string | null;
}

const availabilityEnvelope = z.object({
  availability: menuAvailabilitySchema,
  timeZone: z.string().nullable().optional(),
});

function decodeAvailability(payload: unknown): AvailabilitySettings {
  const parsed = availabilityEnvelope.parse(payload);
  return { availability: parsed.availability, timeZone: parsed.timeZone ?? null };
}

/**
 * This browser's IANA time zone — what the owner's "9 to 5" actually
 * means. Sent with every save so the server can resolve open/closed in
 * the restaurant's local time instead of UTC; null only if the browser
 * reports nothing recognisable (then nothing is sent and UTC is kept).
 */
export function browserTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : null;
}

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

/** The menu's opening windows (`[]` = always open) and its zone. Any member may read. */
export async function fetchAvailability(menuId: string): Promise<AvailabilitySettings> {
  return requestJson(availabilityUrl(menuId), undefined, decodeAvailability);
}

/** Replace the opening windows (owner-only), and the zone they mean. */
export async function saveAvailability(
  menuId: string,
  windows: MenuAvailability,
  timeZone?: string | null
): Promise<AvailabilitySettings> {
  return requestJson(
    availabilityUrl(menuId),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      // `undefined` is dropped by JSON.stringify (zone untouched); `null`
      // is sent so an explicit "UTC" choice clears the stored zone.
      body: JSON.stringify({ windows, timeZone }),
    },
    decodeAvailability
  );
}
