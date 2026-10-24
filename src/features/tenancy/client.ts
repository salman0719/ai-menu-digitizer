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

/** What the owner sees after inviting an address with no account yet. */
const invitationSummarySchema = z.object({
  email: z.string(),
  role: z.enum(["owner", "staff"]),
  expiresAt: z.string(),
});

export type InvitationSummary = z.infer<typeof invitationSummarySchema>;

/** What the invitee's page shows before they accept. */
const invitationDetailsSchema = z.object({
  restaurantName: z.string(),
  email: z.string(),
  role: z.enum(["owner", "staff"]),
  expiresAt: z.string(),
  status: z.enum(["pending", "expired", "accepted"]),
});

export type InvitationDetails = z.infer<typeof invitationDetailsSchema>;

const invitationDetailsEnvelope = z.object({ invitation: invitationDetailsSchema });

/** A still-open invitation as the team panel lists it. */
const pendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["owner", "staff"]),
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedByName: z.string(),
});

export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;

/** One row of the team audit trail. */
const auditEventSchema = z.object({
  id: z.string(),
  action: z.enum([
    "member_added",
    "member_role_changed",
    "member_removed",
    "invitation_sent",
    "invitation_resent",
    "invitation_revoked",
    "invitation_accepted",
  ]),
  actorName: z.string(),
  targetEmail: z.string().nullable(),
  targetName: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});

export type AuditEventOption = z.infer<typeof auditEventSchema>;

const auditEventsEnvelope = z.object({ events: z.array(auditEventSchema) });
const pendingInvitationsEnvelope = z.object({ invitations: z.array(pendingInvitationSchema) });
const invitationSummaryEnvelope = z.object({ invitation: invitationSummarySchema });
const acceptEnvelope = z.object({
  restaurant: z.object({ id: z.string(), name: z.string(), role: z.enum(["owner", "staff"]) }),
});
const addMemberEnvelope = z.union([
  z.object({ member: memberOptionSchema }),
  z.object({ invitation: invitationSummarySchema }),
]);
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
    case "invitation_expired":
    case "invitation_used":
      return "conflict";
    case "wrong_account":
      return "forbidden";
    case "server_db_unavailable":
    case "email_failed":
      return "unavailable";
    default:
      break;
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 410) return "conflict";
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

const invitationPath = (id: string, invitationId?: string) =>
  `/api/restaurants/${encodeURIComponent(id)}/invitations${
    invitationId ? `/${encodeURIComponent(invitationId)}` : ""
  }`;

/** The team list (any member of the restaurant). */
export async function fetchMembers(restaurantId: string): Promise<MemberOption[]> {
  return requestJson(memberPath(restaurantId), undefined, (payload) =>
    membersEnvelope.parse(payload).members
  );
}

/**
 * Owner-only: add a teammate by email. An existing account joins at once;
 * otherwise an invitation email is sent and acceptance happens later.
 */
export async function addMember(
  restaurantId: string,
  email: string,
  role: "owner" | "staff"
): Promise<AddMemberResult> {
  const envelope = await requestJson(
    memberPath(restaurantId),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    },
    (payload) => addMemberEnvelope.parse(payload)
  );
  return "member" in envelope
    ? { kind: "member", member: envelope.member }
    : { kind: "invitation", invitation: envelope.invitation };
}

export type AddMemberResult =
  | { kind: "member"; member: MemberOption }
  | { kind: "invitation"; invitation: InvitationSummary };

/** Pending invitations for the owner's team panel. */
export async function fetchPendingInvitations(
  restaurantId: string
): Promise<PendingInvitation[]> {
  return requestJson(invitationPath(restaurantId), undefined, (payload) =>
    pendingInvitationsEnvelope.parse(payload).invitations
  );
}

/** Owner-only: replace an invitation's link and email it again. */
export async function resendInvitation(
  restaurantId: string,
  invitationId: string
): Promise<InvitationSummary> {
  return requestJson(
    invitationPath(restaurantId, invitationId),
    { method: "POST" },
    (payload) => invitationSummaryEnvelope.parse(payload).invitation
  );
}

/** Owner-only: revoke a pending invitation. */
export async function revokeInvitation(
  restaurantId: string,
  invitationId: string
): Promise<void> {
  await requestJson(invitationPath(restaurantId, invitationId), { method: "DELETE" }, () => undefined);
}

/** Recent team activity (any member of the restaurant). */
export async function fetchAuditEvents(restaurantId: string): Promise<AuditEventOption[]> {
  return requestJson(
    `/api/restaurants/${encodeURIComponent(restaurantId)}/audit`,
    undefined,
    (payload) => auditEventsEnvelope.parse(payload).events
  );
}

/** Public invitation details for the accept page (token holder only). */
export async function fetchInvitation(token: string): Promise<InvitationDetails> {
  return requestJson(`/api/invitations/${encodeURIComponent(token)}`, undefined, (payload) =>
    invitationDetailsEnvelope.parse(payload).invitation
  );
}

/** Accept an invitation for the signed-in account (email must match). */
export async function acceptInvitation(
  token: string
): Promise<{ id: string; name: string; role: "owner" | "staff" }> {
  return requestJson(
    `/api/invitations/${encodeURIComponent(token)}`,
    { method: "POST" },
    (payload) => acceptEnvelope.parse(payload).restaurant
  );
}

/** New-order email preference (any member may read, only an owner may write). */
const alertPrefsSchema = z.object({
  enabled: z.boolean(),
  /** Override recipient; null means the owners' account emails. */
  email: z.string().nullable(),
});

export type AlertPrefs = z.infer<typeof alertPrefsSchema>;

const alertPrefsEnvelope = z.object({ alerts: alertPrefsSchema });
const alertPrefsWithRoleEnvelope = z.object({
  alerts: alertPrefsSchema.extend({ role: z.enum(["owner", "staff"]) }),
});

export type AlertPrefsWithRole = z.infer<typeof alertPrefsWithRoleEnvelope>["alerts"];

export async function fetchAlertPrefs(restaurantId: string): Promise<AlertPrefsWithRole> {
  return requestJson(
    `/api/restaurants/${encodeURIComponent(restaurantId)}/alerts`,
    undefined,
    (payload) => alertPrefsWithRoleEnvelope.parse(payload).alerts
  );
}

export async function updateAlertPrefs(
  restaurantId: string,
  prefs: { enabled: boolean; email: string }
): Promise<AlertPrefs> {
  return requestJson(
    `/api/restaurants/${encodeURIComponent(restaurantId)}/alerts`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs),
    },
    (payload) => alertPrefsEnvelope.parse(payload).alerts
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
