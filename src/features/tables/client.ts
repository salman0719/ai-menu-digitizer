/**
 * Typed browser client for the restaurant-link API
 * (`/api/restaurants/[restaurantId]/slug`). Client-safe: HTTP only.
 *
 * The `/r/<slug>` address is what table QR codes encode, so claiming it is
 * part of printing cards that work on any phone. `ensureRestaurantLink`
 * derives candidates from the restaurant's name (same rules as menu links)
 * and claims the first free one, so the common case is one tap.
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";
import { menuSlugSchema } from "@/features/publishing/schema";
import { slugCandidates, slugifyMenuTitle } from "@/features/publishing/slug";

export interface RestaurantLink {
  id: string;
  name: string;
  slug: string | null;
}

const restaurantLinkSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: menuSlugSchema.nullable(),
});

const restaurantLinkEnvelope = z.object({ restaurant: restaurantLinkSchema });

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
    case "slug_taken":
      return "slug_taken";
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

function slugUrl(restaurantId: string): string {
  return `/api/restaurants/${encodeURIComponent(restaurantId)}/slug`;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** The restaurant's public `/r/<slug>` address (null until claimed). */
export async function fetchRestaurantLink(restaurantId: string): Promise<RestaurantLink> {
  return requestJson(slugUrl(restaurantId), undefined, (payload) =>
    restaurantLinkEnvelope.parse(payload).restaurant
  );
}

/** Set an explicit address (owner-only; 409 when taken). */
export async function setRestaurantLink(
  restaurantId: string,
  slug: string
): Promise<RestaurantLink> {
  return requestJson(slugUrl(restaurantId), jsonInit("PUT", { slug }), (payload) =>
    restaurantLinkEnvelope.parse(payload).restaurant
  );
}

/**
 * Claim the first free address derived from the restaurant's name
 * (owner-only). Returns the existing address untouched when one is set.
 */
export async function ensureRestaurantLink(
  restaurantId: string,
  restaurantName: string
): Promise<RestaurantLink> {
  const current = await fetchRestaurantLink(restaurantId);
  if (current.slug) return current;
  let lastError: unknown = null;
  for (const candidate of slugCandidates(slugifyMenuTitle(restaurantName))) {
    try {
      return await setRestaurantLink(restaurantId, candidate);
    } catch (error) {
      if (error instanceof SyncError && error.code === "slug_taken") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw (
    (lastError as Error) ?? new SyncError("slug_taken", "Could not find a free link.")
  );
}
