/**
 * Typed browser client for the publication API
 * (`/api/menus/[menuId]/publication`) and the public view beacon.
 * Client-safe: HTTP only, no Drizzle and no server repo imports.
 *
 * Shares the `SyncError` taxonomy with the menu/restaurant clients, so the
 * editor handles one error shape across every server call. Responses are
 * re-validated with Zod — a malformed payload surfaces as
 * `SyncError("unavailable")` instead of a half-rendered publish panel.
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";

import { publicationStatusSchema, type PublicationStatus } from "./schema";

const publicationEnvelope = z.object({
  publication: publicationStatusSchema,
});

const optionalPublicationEnvelope = z.object({
  publication: publicationStatusSchema.nullable(),
});

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

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function publicationUrl(menuId: string): string {
  return `/api/menus/${encodeURIComponent(menuId)}/publication`;
}

/** The menu's publication state; null when it has never been published. */
export async function fetchPublication(menuId: string): Promise<PublicationStatus | null> {
  return requestJson(publicationUrl(menuId), undefined, (payload) =>
    optionalPublicationEnvelope.parse(payload).publication
  );
}

/** Publish the current document (or publish changes) with a theme + layout. */
export async function publishMenu(
  menuId: string,
  input: { theme: string; layout: string; slug?: string }
): Promise<PublicationStatus> {
  return requestJson(publicationUrl(menuId), jsonInit("POST", input), (payload) =>
    publicationEnvelope.parse(payload).publication
  );
}

/** Rename the public address. */
export async function setPublicationSlug(
  menuId: string,
  slug: string
): Promise<PublicationStatus> {
  return requestJson(publicationUrl(menuId), jsonInit("PATCH", { slug }), (payload) =>
    publicationEnvelope.parse(payload).publication
  );
}

/** Stop serving the page; the slug stays reserved. */
export async function unpublishMenu(menuId: string): Promise<PublicationStatus> {
  return requestJson(publicationUrl(menuId), { method: "DELETE" }, (payload) =>
    publicationEnvelope.parse(payload).publication
  );
}

/**
 * Count one view of a published page. Deliberately silent: a missed count is
 * not worth surfacing to a diner, and the fetch must never block rendering.
 * The beacon address mirrors the page's own path, so the pair
 * (restaurant, menu) is always spelled out.
 */
export async function recordMenuView(restaurantSlug: string, slug: string): Promise<void> {
  try {
    await fetch(
      `/api/r/${encodeURIComponent(restaurantSlug)}/m/${encodeURIComponent(slug)}/view`,
      { method: "POST" }
    );
  } catch {
    // Ignored — see above.
  }
}
