/**
 * Typed browser client for /api/restaurants. Client-safe: HTTP only, no
 * Drizzle. Shares the `SyncError` taxonomy with the menu sync client so the
 * UI handles one error shape across both APIs (same origin, same envelope:
 * { error: { code, message } }).
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";

/** All we need to pick a move target or show a restaurant name. */
const restaurantOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(["owner", "staff"]),
});

export type RestaurantOption = z.infer<typeof restaurantOptionSchema>;

/** A team member: account info plus their role in one restaurant. */
const memberOptionSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: z.enum(["owner", "staff"]),
});

export type MemberOption = z.infer<typeof memberOptionSchema>;

const listEnvelope = z.object({ restaurants: z.array(restaurantOptionSchema) });
const restaurantEnvelope = z.object({ restaurant: restaurantOptionSchema });
const membersEnvelope = z.object({ members: z.array(memberOptionSchema) });
const memberEnvelope = z.object({ member: memberOptionSchema });
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
    case "user_not_found":
      return "not_found";
    case "invalid_body":
      return "invalid";
    case "already_member":
    case "last_owner":
      return "conflict";
    case "server_db_unavailable":
      return "unavailable";
    default:
      break;
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
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
    throw new SyncError("unavailable", "The server sent data this app could not understand.");
  }
}

/** The caller's restaurants (with their role), for pickers and headings. */
export async function fetchRestaurants(): Promise<RestaurantOption[]> {
  return requestJson("/api/restaurants", undefined, (payload) =>
    listEnvelope.parse(payload).restaurants
  );
}

/** Create a restaurant; the caller becomes its owner. */
export async function createRestaurant(name: string): Promise<RestaurantOption> {
  return requestJson(
    "/api/restaurants",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
    (payload) => restaurantEnvelope.parse(payload).restaurant
  );
}

/** Owner-only rename. */
export async function renameRestaurant(id: string, name: string): Promise<RestaurantOption> {
  return requestJson(
    `/api/restaurants/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
    (payload) => restaurantEnvelope.parse(payload).restaurant
  );
}

/**
 * Owner-only delete. Memberships, menus, published pages and orders are
 * deleted too — the UI must warn about that before calling.
 */
export async function deleteRestaurant(id: string): Promise<void> {
  await requestJson(`/api/restaurants/${encodeURIComponent(id)}`, { method: "DELETE" }, () => undefined);
}

const memberPath = (id: string, memberUserId?: string) =>
  `/api/restaurants/${encodeURIComponent(id)}/members${
    memberUserId ? `/${encodeURIComponent(memberUserId)}` : ""
  }`;

/** The team list (any member of the restaurant). */
export async function fetchMembers(restaurantId: string): Promise<MemberOption[]> {
  return requestJson(memberPath(restaurantId), undefined, (payload) =>
    membersEnvelope.parse(payload).members
  );
}

/** Owner-only: add an existing account by email. They must have signed in once. */
export async function addMember(
  restaurantId: string,
  email: string,
  role: "owner" | "staff"
): Promise<MemberOption> {
  return requestJson(
    memberPath(restaurantId),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    },
    (payload) => memberEnvelope.parse(payload).member
  );
}

/** Owner-only role change; refuses to leave the restaurant without an owner. */
export async function updateMemberRole(
  restaurantId: string,
  memberUserId: string,
  role: "owner" | "staff"
): Promise<MemberOption> {
  return requestJson(
    memberPath(restaurantId, memberUserId),
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    },
    (payload) => memberEnvelope.parse(payload).member
  );
}

/** Owner-only removal; refuses to remove the last owner. */
export async function removeMember(restaurantId: string, memberUserId: string): Promise<void> {
  await requestJson(memberPath(restaurantId, memberUserId), { method: "DELETE" }, () => undefined);
}
