import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as deleteRestaurant,
  PATCH as renameRestaurant,
} from "@/app/api/restaurants/[restaurantId]/route";
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
