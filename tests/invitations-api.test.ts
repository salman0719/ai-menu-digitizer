import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as getInvitation,
  POST as acceptInvitationRoute,
} from "@/app/api/invitations/[token]/route";
import { POST as addMember } from "@/app/api/restaurants/[restaurantId]/members/route";
import { GET as listInvitations } from "@/app/api/restaurants/[restaurantId]/invitations/route";
import {
  DELETE as revokeInvitation,
  POST as resendInvitation,
} from "@/app/api/restaurants/[restaurantId]/invitations/[invitationId]/route";
import { createRestaurant } from "@/features/tenancy/repo";
import { restaurantInvitation } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for email invitations. Real route handlers and the real
 * generated schema (PGlite) run end to end; only the session lookup and the
 * email sender are stubbed, so the invitation token is captured exactly as a
 * real invitee would receive it and then used to accept.
 */

const holder: { db: TestDb | null; userId: string | null } = { db: null, userId: null };

interface CapturedEmail {
  email: string;
  url: string;
  restaurantName: string;
  role: string;
}

const emailHolder: { calls: CapturedEmail[]; failNext: boolean } = { calls: [], failNext: false };

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

vi.mock("@/lib/auth/email", () => ({
  sendMagicLinkEmail: vi.fn(async () => undefined),
  sendInvitationEmail: vi.fn(async (input: CapturedEmail) => {
    if (emailHolder.failNext) throw new Error("send failed");
    emailHolder.calls.push(input);
  }),
}));

async function initTestDb(): Promise<TestDb> {
  const { createTestDb } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  return db;
}

function asRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://test.local${url}`, init);
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return asRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function restaurantParams(restaurantId: string): { params: Promise<{ restaurantId: string }> } {
  return { params: Promise.resolve({ restaurantId }) };
}

function invitationParams(token: string): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token }) };
}

function pendingParams(
  restaurantId: string,
  invitationId: string
): { params: Promise<{ restaurantId: string; invitationId: string }> } {
  return { params: Promise.resolve({ restaurantId, invitationId }) };
}

/** Pull the one-time token out of the emailed accept URL. */
function tokenFromUrl(url: string): string {
  const path = new URL(url, "https://eateryo.invalid").pathname;
  return decodeURIComponent(path.split("/").pop() ?? "");
}

beforeEach(async () => {
  holder.db = await initTestDb();
  holder.userId = null;
  emailHolder.calls = [];
  emailHolder.failNext = false;
}, 30_000);

async function seedOwnerAndRestaurant() {
  const { seedUser } = await import("./helpers/pg-test-db");
  const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
  const created = await createRestaurant(holder.db!, owner, "My Cafe");
  holder.userId = owner;
  return { owner, restaurantId: created.id };
}

describe("POST /api/restaurants/[restaurantId]/members — invitation fallback", () => {
  it("emails a one-time invitation, and the token accepts after sign-up", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const { restaurantId } = await seedOwnerAndRestaurant();

    const invited = await addMember(
      jsonRequest(`/api/restaurants/${restaurantId}/members`, "POST", {
        email: "new.person@cafe.test",
        role: "staff",
      }),
      restaurantParams(restaurantId)
    );
    expect(invited.status).toBe(201);
    expect((await invited.json()).invitation).toMatchObject({
      email: "new.person@cafe.test",
      role: "staff",
    });

    expect(emailHolder.calls).toHaveLength(1);
    expect(emailHolder.calls[0]).toMatchObject({
      email: "new.person@cafe.test",
      restaurantName: "My Cafe",
      role: "staff",
    });
    const token = tokenFromUrl(emailHolder.calls[0]!.url);
    expect(token.length).toBeGreaterThan(20);

    // The invitee can read the public details before signing in.
    const details = await getInvitation(
      asRequest(`/api/invitations/${token}`),
      invitationParams(token)
    );
    expect(details.status).toBe(200);
    expect(details.headers.get("Cache-Control")).toBe("no-store");
    expect((await details.json()).invitation).toMatchObject({
      restaurantName: "My Cafe",
      email: "new.person@cafe.test",
      role: "staff",
      status: "pending",
    });

    // Signing in with that address creates the account (magic-link signup)…
    const invitee = await seedUser(holder.db!, "New.Person@cafe.test", "New Person");
    holder.userId = invitee;

    // …and accepting turns the invitation into a membership.
    const accepted = await acceptInvitationRoute(
      asRequest(`/api/invitations/${token}`, { method: "POST" }),
      invitationParams(token)
    );
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).restaurant).toMatchObject({ name: "My Cafe", role: "staff" });

    // A second accept is refused as already used.
    const second = await acceptInvitationRoute(
      asRequest(`/api/invitations/${token}`, { method: "POST" }),
      invitationParams(token)
    );
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("invitation_used");
  });

  it("reports email delivery failure instead of pretending it was sent", async () => {
    const { restaurantId } = await seedOwnerAndRestaurant();
    emailHolder.failNext = true;

    const res = await addMember(
      jsonRequest(`/api/restaurants/${restaurantId}/members`, "POST", {
        email: "no-mail@cafe.test",
        role: "staff",
      }),
      restaurantParams(restaurantId)
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("email_failed");
  });

  it("refuses invitations from staff callers", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner2@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff2@cafe.test", "Staff");
    const created = await createRestaurant(holder.db!, owner, "Guarded Cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });
    holder.userId = staff;

    const res = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", {
        email: "friend@cafe.test",
        role: "staff",
      }),
      restaurantParams(created.id)
    );
    expect(res.status).toBe(403);
    expect(emailHolder.calls).toHaveLength(0);
  });
});

describe("pending invitations API", () => {
  it("lists open invitations for the owner and nobody else", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const { restaurantId, owner } = await seedOwnerAndRestaurant();
    await addMember(
      jsonRequest(`/api/restaurants/${restaurantId}/members`, "POST", {
        email: "pending@cafe.test",
        role: "staff",
      }),
      restaurantParams(restaurantId)
    );

    const res = await listInvitations(
      asRequest(`/api/restaurants/${restaurantId}/invitations`),
      restaurantParams(restaurantId)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const payload = await res.json();
    expect(payload.invitations).toHaveLength(1);
    expect(payload.invitations[0]).toMatchObject({ email: "pending@cafe.test", role: "staff" });

    const staff = await seedUser(holder.db!, "staff-pending@cafe.test", "Staff");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId, userId: staff, role: "staff" });
    holder.userId = staff;
    const denied = await listInvitations(
      asRequest(`/api/restaurants/${restaurantId}/invitations`),
      restaurantParams(restaurantId)
    );
    expect(denied.status).toBe(403);

    const outsider = await seedUser(holder.db!, "outsider-pending@cafe.test", "Outsider");
    holder.userId = outsider;
    const hidden = await listInvitations(
      asRequest(`/api/restaurants/${restaurantId}/invitations`),
      restaurantParams(restaurantId)
    );
    expect(hidden.status).toBe(404);

    holder.userId = owner;
  });

  it("resends with a fresh link and revokes it", async () => {
    const { restaurantId } = await seedOwnerAndRestaurant();
    await addMember(
      jsonRequest(`/api/restaurants/${restaurantId}/members`, "POST", {
        email: "rotate@cafe.test",
        role: "staff",
      }),
      restaurantParams(restaurantId)
    );
    const oldToken = tokenFromUrl(emailHolder.calls[0]!.url);

    const listed = await listInvitations(
      asRequest(`/api/restaurants/${restaurantId}/invitations`),
      restaurantParams(restaurantId)
    );
    const invitationId = (await listed.json()).invitations[0].id as string;

    const resent = await resendInvitation(
      asRequest(`/api/restaurants/${restaurantId}/invitations/${invitationId}`, {
        method: "POST",
      }),
      pendingParams(restaurantId, invitationId)
    );
    expect(resent.status).toBe(200);
    expect(emailHolder.calls).toHaveLength(2);
    const newToken = tokenFromUrl(emailHolder.calls[1]!.url);
    expect(newToken).not.toBe(oldToken);

    // The previous link is dead; the new one resolves.
    const stale = await getInvitation(asRequest(`/api/invitations/${oldToken}`),
      invitationParams(oldToken));
    expect(stale.status).toBe(404);
    const fresh = await getInvitation(asRequest(`/api/invitations/${newToken}`),
      invitationParams(newToken));
    expect(fresh.status).toBe(200);

    // Re-sending replaces the row, so the panel re-reads the list (and its
    // new id) before acting on it again — mirror that here.
    const relisted = await listInvitations(
      asRequest(`/api/restaurants/${restaurantId}/invitations`),
      restaurantParams(restaurantId)
    );
    const rotatedId = (await relisted.json()).invitations[0].id as string;

    const revoked = await revokeInvitation(
      asRequest(`/api/restaurants/${restaurantId}/invitations/${rotatedId}`, {
        method: "DELETE",
      }),
      pendingParams(restaurantId, rotatedId)
    );
    expect(revoked.status).toBe(204);

    const afterRevoke = await getInvitation(
      asRequest(`/api/invitations/${newToken}`),
      invitationParams(newToken)
    );
    expect(afterRevoke.status).toBe(404);

    const empty = await listInvitations(
      asRequest(`/api/restaurants/${restaurantId}/invitations`),
      restaurantParams(restaurantId)
    );
    expect((await empty.json()).invitations).toHaveLength(0);
  });
});

describe("POST /api/invitations/[token]", () => {
  it("requires a session and an existing invitation", async () => {
    const { restaurantId } = await seedOwnerAndRestaurant();
    await addMember(
      jsonRequest(`/api/restaurants/${restaurantId}/members`, "POST", {
        email: "someone@cafe.test",
        role: "staff",
      }),
      restaurantParams(restaurantId)
    );
    const token = tokenFromUrl(emailHolder.calls[0]!.url);

    holder.userId = null;
    const anonymous = await acceptInvitationRoute(
      asRequest(`/api/invitations/${token}`, { method: "POST" }),
      invitationParams(token)
    );
    expect(anonymous.status).toBe(401);

    // Signed in, but no such invitation: 404, never a leak about other tokens.
    const { seedUser } = await import("./helpers/pg-test-db");
    holder.userId = await seedUser(holder.db!, "someone@cafe.test", "Someone");
    const missing = await acceptInvitationRoute(
      asRequest("/api/invitations/not-a-real-token", { method: "POST" }),
      invitationParams("not-a-real-token")
    );
    expect(missing.status).toBe(404);
  });

  it("refuses a different signed-in account and expired links", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const { restaurantId } = await seedOwnerAndRestaurant();
    await addMember(
      jsonRequest(`/api/restaurants/${restaurantId}/members`, "POST", {
        email: "wanted@cafe.test",
        role: "staff",
      }),
      restaurantParams(restaurantId)
    );
    const token = tokenFromUrl(emailHolder.calls[0]!.url);

    const stranger = await seedUser(holder.db!, "stranger@cafe.test", "Stranger");
    holder.userId = stranger;
    const wrong = await acceptInvitationRoute(
      asRequest(`/api/invitations/${token}`, { method: "POST" }),
      invitationParams(token)
    );
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error.code).toBe("wrong_account");

    // Expire it, then try with the right account.
    const { eq } = await import("drizzle-orm");
    await holder
      .db!.update(restaurantInvitation)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(restaurantInvitation.restaurantId, restaurantId));
    const wanted = await seedUser(holder.db!, "wanted@cafe.test", "Wanted");
    holder.userId = wanted;
    const expired = await acceptInvitationRoute(
      asRequest(`/api/invitations/${token}`, { method: "POST" }),
      invitationParams(token)
    );
    expect(expired.status).toBe(410);
    expect((await expired.json()).error.code).toBe("invitation_expired");
  });
});
