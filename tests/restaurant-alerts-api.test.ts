import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAlerts, PUT as putAlerts } from "@/app/api/restaurants/[restaurantId]/alerts/route";
import { addMemberForOwner, createRestaurant } from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * R0.4c — GET|PUT /api/restaurants/[restaurantId]/alerts. Any member may
 * read; only an owner may write. Outsiders get 404 (ids stay unprobeable),
 * staff writers get 403, anonymous callers get 401, and bad addresses
 * get 400 — never a silent accept.
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

let ownerId: string;
let staffId: string;
let outsiderId: string;
let restaurantId: string;

function params() {
  return { params: Promise.resolve({ restaurantId }) };
}

function putRequest(body: unknown): Request {
  return new Request(`http://test.local/api/restaurants/${restaurantId}/alerts`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "alerts-api-owner@cafe.test", "Owner");
  staffId = await seedUser(holder.db, "alerts-api-staff@cafe.test", "Staff");
  outsiderId = await seedUser(holder.db, "alerts-api-out@cafe.test", "Outsider");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Cafe Alerts")).id;
  await addMemberForOwner(holder.db, ownerId, restaurantId, "alerts-api-staff@cafe.test", "staff");
}, 30_000);

describe("GET /api/restaurants/[restaurantId]/alerts", () => {
  it("reads for members, 404s across tenants, 401s anonymously", async () => {
    holder.userId = ownerId;
    const ownerRes = await getAlerts(new Request("http://test.local/"), params());
    expect(ownerRes.status).toBe(200);
    expect((await ownerRes.json()).alerts).toMatchObject({ enabled: true, email: null });

    holder.userId = staffId;
    const staffRes = await getAlerts(new Request("http://test.local/"), params());
    expect(staffRes.status).toBe(200);
    expect((await staffRes.json()).alerts.role).toBe("staff");

    holder.userId = outsiderId;
    const outRes = await getAlerts(new Request("http://test.local/"), params());
    expect(outRes.status).toBe(404);

    holder.userId = null;
    const anonRes = await getAlerts(new Request("http://test.local/"), params());
    expect(anonRes.status).toBe(401);
  });
});

describe("PUT /api/restaurants/[restaurantId]/alerts", () => {
  it("writes for owners, normalizing the override address", async () => {
    holder.userId = ownerId;
    const res = await putAlerts(
      putRequest({ enabled: true, email: "  Till@Cafe.Test " }),
      params()
    );
    expect(res.status).toBe(200);
    expect((await res.json()).alerts).toEqual({ enabled: true, email: "till@cafe.test" });

    const cleared = await putAlerts(putRequest({ enabled: false, email: "" }), params());
    expect((await cleared.json()).alerts).toEqual({ enabled: false, email: null });
  });

  it("refuses bad addresses, staff writers, outsiders, and strangers", async () => {
    holder.userId = ownerId;
    const bad = await putAlerts(putRequest({ enabled: true, email: "not-an-email" }), params());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_body");

    holder.userId = staffId;
    const staffRes = await putAlerts(putRequest({ enabled: false, email: "" }), params());
    expect(staffRes.status).toBe(403);

    holder.userId = outsiderId;
    const outRes = await putAlerts(putRequest({ enabled: false, email: "" }), params());
    expect(outRes.status).toBe(404);

    holder.userId = null;
    const anonRes = await putAlerts(putRequest({ enabled: false, email: "" }), params());
    expect(anonRes.status).toBe(401);
  });
});
