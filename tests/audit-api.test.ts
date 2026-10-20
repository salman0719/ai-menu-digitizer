import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listAudit } from "@/app/api/restaurants/[restaurantId]/audit/route";
import { addMemberForOwner, createRestaurant, updateMemberRoleForOwner } from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for GET /api/restaurants/[restaurantId]/audit: real
 * handler, real schema (PGlite), stubbed session. The trail is a team view
 * (staff included) but never leaks across tenants, and never gets cached.
 */

const holder: { db: TestDb | null; userId: string | null } = { db: null, userId: null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

function restaurantParams(restaurantId: string): { params: Promise<{ restaurantId: string }> } {
  return { params: Promise.resolve({ restaurantId }) };
}

beforeEach(async () => {
  const { createTestDb } = await import("./helpers/pg-test-db");
  holder.db = (await createTestDb()).db;
  holder.userId = null;
}, 30_000);

describe("GET /api/restaurants/[restaurantId]/audit", () => {
  it("lists the trail for members, newest first, and hides it from outsiders", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const owner = await seedUser(holder.db!, "owner@audit-api.test", "Owner");
    const staff = await seedUser(holder.db!, "staff@audit-api.test", "Staff");
    const outsider = await seedUser(holder.db!, "outsider@audit-api.test", "Outsider");
    const place = await createRestaurant(holder.db!, owner, "Audit API Cafe");
    await addMemberForOwner(holder.db!, owner, place.id, "staff@audit-api.test", "staff");
    await updateMemberRoleForOwner(holder.db!, owner, place.id, staff, "owner");

    holder.userId = staff;
    const res = await listAudit(
      new Request(`http://test.local/api/restaurants/${place.id}/audit`),
      restaurantParams(place.id)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const payload = await res.json();
    expect(payload.events.map((event: { action: string }) => event.action)).toEqual([
      "member_role_changed",
      "member_added",
    ]);
    expect(payload.events[0]).toMatchObject({
      actorName: "Owner",
      targetName: "Staff",
      detail: "staff → owner",
    });

    holder.userId = outsider;
    const hidden = await listAudit(
      new Request(`http://test.local/api/restaurants/${place.id}/audit`),
      restaurantParams(place.id)
    );
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).error.code).toBe("not_found");

    holder.userId = null;
    const anonymous = await listAudit(
      new Request(`http://test.local/api/restaurants/${place.id}/audit`),
      restaurantParams(place.id)
    );
    expect(anonymous.status).toBe(401);
  });
});
