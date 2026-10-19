import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as deleteRestaurant,
  PATCH as renameRestaurant,
} from "@/app/api/restaurants/[restaurantId]/route";
import {
  GET as listMembers,
  POST as addMember,
} from "@/app/api/restaurants/[restaurantId]/members/route";
import {
  DELETE as removeMember,
  PATCH as updateMember,
} from "@/app/api/restaurants/[restaurantId]/members/[userId]/route";
import {
  createRestaurant,
  getRestaurantForUser,
  listRestaurantsForUser,
} from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for the owner-only restaurant mutations. Real route
 * handlers run against the real generated schema (PGlite), with only the
 * session lookup stubbed — so auth/tenancy/validation behaviour is exercised
 * end to end through fetch-level Request/Response objects. `vi.mock` is
 * hoisted by vitest above the imports; the factories only dereference
 * `holder` inside lazy closures, when handlers actually run.
 */

const holder: { db: TestDb | null; userId: string | null } = {
  db: null,
  userId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
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

/** Next 16 route handlers receive dynamic params as a promise. */
function restaurantParams(restaurantId: string): { params: Promise<{ restaurantId: string }> } {
  return { params: Promise.resolve({ restaurantId }) };
}

function memberParams(
  restaurantId: string,
  userId: string
): { params: Promise<{ restaurantId: string; userId: string }> } {
  return { params: Promise.resolve({ restaurantId, userId }) };
}

// PGlite boot + migrating the real DDL takes seconds; under a fully parallel
// suite the 10s default hook timeout is too tight (the other PGlite files
// already allow 30s). A timeout here is harness budget, not a relaxed check.
beforeEach(async () => {
  holder.db = await initTestDb();
  holder.userId = null;
}, 30_000);

describe("PATCH /api/restaurants/[restaurantId]", () => {
  it("returns 401 with the shared error shape when signed out", async () => {
    const res = await renameRestaurant(
      jsonRequest("/api/restaurants/r1", "PATCH", { name: "New name" }),
      restaurantParams("r1")
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("rejects an empty name with 400 and a field message", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    holder.userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");

    const res = await renameRestaurant(
      jsonRequest("/api/restaurants/r1", "PATCH", { name: "   " }),
      restaurantParams("r1")
    );
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.code).toBe("invalid_body");
    expect(typeof payload.error.message).toBe("string");
  });

  it("lets the owner rename and returns the updated restaurant", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const created = await createRestaurant(holder.db!, userId, "My cafe");
    holder.userId = userId;

    const res = await renameRestaurant(
      jsonRequest(`/api/restaurants/${created.id}`, "PATCH", { name: "  Sunny Side Café  " }),
      restaurantParams(created.id)
    );
    expect(res.status).toBe(200);
    // Personalized data must never be cached.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const payload = await res.json();
    expect(payload.restaurant).toMatchObject({ id: created.id, name: "Sunny Side Café", role: "owner" });

    const fetched = await getRestaurantForUser(holder.db!, userId, created.id);
    expect(fetched).toMatchObject({ name: "Sunny Side Café" });
  });

  it("refuses staff with 403 and outsiders with 404 (ids stay unprobeable)", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });

    holder.userId = staff;
    const staffRes = await renameRestaurant(
      jsonRequest(`/api/restaurants/${created.id}`, "PATCH", { name: "Renamed by staff" }),
      restaurantParams(created.id)
    );
    expect(staffRes.status).toBe(403);
    expect((await staffRes.json()).error.code).toBe("forbidden");

    holder.userId = outsider;
    const outsiderRes = await renameRestaurant(
      jsonRequest(`/api/restaurants/${created.id}`, "PATCH", { name: "Hijacked" }),
      restaurantParams(created.id)
    );
    expect(outsiderRes.status).toBe(404);
    expect((await outsiderRes.json()).error.code).toBe("not_found");

    // The name is untouched.
    const fetched = await getRestaurantForUser(holder.db!, owner, created.id);
    expect(fetched).toMatchObject({ name: "My cafe" });
  });
});

describe("DELETE /api/restaurants/[restaurantId]", () => {
  it("returns 401 when signed out", async () => {
    const res = await deleteRestaurant(asRequest("/api/restaurants/r1", { method: "DELETE" }), {
      params: Promise.resolve({ restaurantId: "r1" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("lets the owner delete: 204, and the restaurant is gone", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const created = await createRestaurant(holder.db!, userId, "My cafe");
    holder.userId = userId;

    const res = await deleteRestaurant(
      asRequest(`/api/restaurants/${created.id}`, { method: "DELETE" }),
      restaurantParams(created.id)
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    expect(await getRestaurantForUser(holder.db!, userId, created.id)).toBeNull();
    expect(await listRestaurantsForUser(holder.db!, userId)).toEqual([]);
  });

  it("refuses staff with 403 and outsiders with 404, leaving the row intact", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });

    holder.userId = staff;
    const staffRes = await deleteRestaurant(
      asRequest(`/api/restaurants/${created.id}`, { method: "DELETE" }),
      restaurantParams(created.id)
    );
    expect(staffRes.status).toBe(403);
    expect((await staffRes.json()).error.code).toBe("forbidden");

    holder.userId = outsider;
    const outsiderRes = await deleteRestaurant(
      asRequest(`/api/restaurants/${created.id}`, { method: "DELETE" }),
      restaurantParams(created.id)
    );
    expect(outsiderRes.status).toBe(404);
    expect((await outsiderRes.json()).error.code).toBe("not_found");

    expect(await getRestaurantForUser(holder.db!, owner, created.id)).toMatchObject({
      id: created.id,
    });
  });
});

describe("GET /api/restaurants/[restaurantId]/members", () => {
  it("returns 401 when signed out and 404 for outsiders", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const created = await createRestaurant(holder.db!, owner, "My cafe");

    const anonymous = await listMembers(asRequest("/api/restaurants/x/members"),
      restaurantParams(created.id));
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error.code).toBe("unauthorized");

    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    holder.userId = outsider;
    const denied = await listMembers(asRequest("/api/restaurants/x/members"),
      restaurantParams(created.id));
    expect(denied.status).toBe(404);
    expect((await denied.json()).error.code).toBe("not_found");
  });

  it("lists the team for staff too, uncacheable", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff Person");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });

    holder.userId = staff;
    const res = await listMembers(
      asRequest(`/api/restaurants/${created.id}/members`),
      restaurantParams(created.id)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const payload = await res.json();
    expect(payload.members).toHaveLength(2);
    expect(payload.members.find((m: { userId: string }) => m.userId === staff)).toMatchObject({
      name: "Staff Person",
      role: "staff",
    });
  });
});

describe("POST /api/restaurants/[restaurantId]/members", () => {
  it("lets the owner add an existing account by email", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff Person");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    holder.userId = owner;

    const res = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", {
        email: "STAFF@cafe.test",
        role: "staff",
      }),
      restaurantParams(created.id)
    );
    expect(res.status).toBe(201);
    expect((await res.json()).member).toMatchObject({
      userId: staff,
      email: "staff@cafe.test",
      role: "staff",
    });
  });

  it("rejects invalid bodies, unknown emails and duplicates", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    holder.userId = owner;

    const invalid = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", {
        email: "not-an-email",
        role: "staff",
      }),
      restaurantParams(created.id)
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_body");

    const unknown = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", {
        email: "nobody@cafe.test",
        role: "staff",
      }),
      restaurantParams(created.id)
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("user_not_found");

    await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", {
        email: "staff@cafe.test",
        role: "staff",
      }),
      restaurantParams(created.id)
    );
    const duplicate = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", {
        email: "staff@cafe.test",
        role: "owner",
      }),
      restaurantParams(created.id)
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe("already_member");
  });

  it("refuses staff with 403 and outsiders with 404", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });

    const body = { email: "outsider@cafe.test", role: "staff" };
    holder.userId = staff;
    const staffRes = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", body),
      restaurantParams(created.id)
    );
    expect(staffRes.status).toBe(403);
    expect((await staffRes.json()).error.code).toBe("forbidden");

    holder.userId = outsider;
    const outsiderRes = await addMember(
      jsonRequest(`/api/restaurants/${created.id}/members`, "POST", body),
      restaurantParams(created.id)
    );
    expect(outsiderRes.status).toBe(404);
    expect((await outsiderRes.json()).error.code).toBe("not_found");
  });
});

describe("PATCH/DELETE /api/restaurants/[restaurantId]/members/[userId]", () => {
  it("changes a role and refuses to demote the last owner", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });
    holder.userId = owner;

    const promoted = await updateMember(
      jsonRequest(`/api/restaurants/${created.id}/members/${staff}`, "PATCH", { role: "owner" }),
      memberParams(created.id, staff)
    );
    expect(promoted.status).toBe(200);
    expect((await promoted.json()).member).toMatchObject({ userId: staff, role: "owner" });

    // Demote the extra owner again, then the sole owner must be refused.
    await updateMember(
      jsonRequest(`/api/restaurants/${created.id}/members/${staff}`, "PATCH", { role: "staff" }),
      memberParams(created.id, staff)
    );
    const lastOwner = await updateMember(
      jsonRequest(`/api/restaurants/${created.id}/members/${owner}`, "PATCH", { role: "staff" }),
      memberParams(created.id, owner)
    );
    expect(lastOwner.status).toBe(409);
    expect((await lastOwner.json()).error.code).toBe("last_owner");
  });

  it("removes a member (204) and refuses to remove the last owner", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });
    holder.userId = owner;

    const removed = await removeMember(
      asRequest(`/api/restaurants/${created.id}/members/${staff}`, { method: "DELETE" }),
      memberParams(created.id, staff)
    );
    expect(removed.status).toBe(204);

    const lastOwner = await removeMember(
      asRequest(`/api/restaurants/${created.id}/members/${owner}`, { method: "DELETE" }),
      memberParams(created.id, owner)
    );
    expect(lastOwner.status).toBe(409);
    expect((await lastOwner.json()).error.code).toBe("last_owner");
  });

  it("refuses staff with 403 and outsiders with 404", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    const created = await createRestaurant(holder.db!, owner, "My cafe");
    const { restaurantMembership } = await import("@/lib/db/schema");
    await holder
      .db!.insert(restaurantMembership)
      .values({ restaurantId: created.id, userId: staff, role: "staff" });

    holder.userId = staff;
    const staffRes = await updateMember(
      jsonRequest(`/api/restaurants/${created.id}/members/${owner}`, "PATCH", { role: "staff" }),
      memberParams(created.id, owner)
    );
    expect(staffRes.status).toBe(403);
    expect((await staffRes.json()).error.code).toBe("forbidden");

    holder.userId = outsider;
    const outsiderRes = await removeMember(
      asRequest(`/api/restaurants/${created.id}/members/${staff}`, { method: "DELETE" }),
      memberParams(created.id, staff)
    );
    expect(outsiderRes.status).toBe(404);
    expect((await outsiderRes.json()).error.code).toBe("not_found");
  });
});
