import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMenuForUser } from "@/features/menus/repo";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema } from "@/features/menu/schema";
import {
  buildAccountExport,
  deleteAccountForUser,
  isCronAuthorized,
  purgeOldOrders,
} from "@/features/retention/repo";
import { orderRetentionDays, retentionCutoff } from "@/features/retention/schema";
import { createRestaurant } from "@/features/tenancy/repo";
import {
  menu as menuTable,
  order as orderTable,
  orderLine as orderLineTable,
  orderRateLimit,
  restaurant,
  restaurantMembership,
  user as userTable,
} from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * Step 11 — retention, export, and deletion. These pin the promises the
 * privacy page makes: old orders disappear, an export contains only the
 * caller's data, and deleting an account removes what it created without
 * touching restaurants it only worked at.
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

const NOW = new Date("2026-10-18T12:00:00.000Z");
const OLD = new Date("2026-06-01T12:00:00.000Z");

function menuDoc(id: string, title: string) {
  return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id, title });
}

async function insertOrder(
  db: TestDb,
  restaurantId: string,
  createdAt: Date,
  note: string | null = null
): Promise<string> {
  const rows = await db
    .insert(orderTable)
    .values({
      restaurantId,
      menuTitle: "Retention Café",
      tableLabel: "3",
      note,
      status: "served",
      totalCents: 450,
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: orderTable.id });
  const id = rows[0].id;
  await db.insert(orderLineTable).values({
    orderId: id,
    menuItemId: "item-1",
    name: "Espresso",
    unitPriceCents: 450,
    quantity: 1,
  });
  return id;
}

describe("retention settings", () => {
  it("defaults to 90 days and clamps nonsense", () => {
    expect(orderRetentionDays({})).toBe(90);
    expect(orderRetentionDays({ ORDER_RETENTION_DAYS: "30" })).toBe(30);
    expect(orderRetentionDays({ ORDER_RETENTION_DAYS: "-5" })).toBe(90);
    expect(orderRetentionDays({ ORDER_RETENTION_DAYS: "99999" })).toBe(3650);
    expect(retentionCutoff(NOW, 90).toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("only authorizes the exact cron bearer secret", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(isCronAuthorized(null, "s3cret")).toBe(false);
    expect(isCronAuthorized("Bearer s3cret", undefined)).toBe(false);
  });
});

describe("retention repo", () => {
  let db: TestDb;
  let ownerId: string;
  let restaurantId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    ({ db } = await createTestDb());
    ownerId = await seedUser(db, "retention@cafe.test", "Retention Owner");
    restaurantId = (await createRestaurant(db, ownerId, "Retention Café")).id;
  }, 30_000);

  it("purges only orders older than the window, with their lines", async () => {
    const oldId = await insertOrder(db, restaurantId, OLD);
    const recentId = await insertOrder(db, restaurantId, NOW);

    const purged = await purgeOldOrders(db, retentionCutoff(NOW, 90), NOW);
    expect(purged.orders).toBe(1);

    const remaining = await db.select({ id: orderTable.id }).from(orderTable);
    expect(remaining.map((row) => row.id)).toEqual([recentId]);

    const lines = await db.select({ orderId: orderLineTable.orderId }).from(orderLineTable);
    expect(lines.map((row) => row.orderId)).toEqual([recentId]);
    expect(lines.some((row) => row.orderId === oldId)).toBe(false);
  });

  it("sweeps stale rate-limit windows and leaves fresh ones", async () => {
    await db.insert(orderRateLimit).values([
      { key: "old", windowStart: new Date(NOW.getTime() - 48 * 60 * 60 * 1000), count: 3 },
      { key: "fresh", windowStart: NOW, count: 1 },
    ]);
    const result = await purgeOldOrders(db, retentionCutoff(NOW, 90), NOW);
    expect(result.rateLimitWindows).toBe(1);
    const keys = await db.select({ key: orderRateLimit.key }).from(orderRateLimit);
    expect(keys.map((row) => row.key)).toEqual(["fresh"]);
  });

  it("exports the caller's data and nothing from another tenant", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const otherId = await seedUser(db, "other@cafe.test", "Other Owner");
    await createRestaurant(db, otherId, "Other Café");
    await createMenuForUser(db, ownerId, restaurantId, menuDoc("menu-export", "Export Menu"));
    await insertOrder(db, restaurantId, NOW, "extra napkins");

    const data = await buildAccountExport(db, ownerId, NOW);
    expect(data.account?.email).toBe("retention@cafe.test");
    expect(data.restaurants.map((row) => row.name)).toEqual(["Retention Café"]);
    expect(data.menus.map((row) => row.title)).toEqual(["Export Menu"]);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0].note).toBe("extra napkins");
    expect(data.orders[0].lines).toEqual([
      { menuItemId: "item-1", name: "Espresso", variantName: null, unitPriceCents: 450, quantity: 1 },
    ]);

    const other = await buildAccountExport(db, otherId, NOW);
    expect(other.restaurants.map((row) => row.name)).toEqual(["Other Café"]);
    expect(other.menus).toHaveLength(0);
    expect(other.orders).toHaveLength(0);
  });

  it("deletes what the account created and keeps restaurants it only works at", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const otherId = await seedUser(db, "boss@cafe.test", "Boss");
    const otherRestaurant = (await createRestaurant(db, otherId, "Someone Else's Café")).id;
    await createMenuForUser(db, otherId, otherRestaurant, menuDoc("menu-other", "Other Menu"));
    await db.insert(restaurantMembership).values({
      restaurantId: otherRestaurant,
      userId: ownerId,
      role: "staff",
    });
    await insertOrder(db, restaurantId, NOW);
    await createMenuForUser(db, ownerId, restaurantId, menuDoc("menu-owned", "Owned Menu"));

    const result = await deleteAccountForUser(db, ownerId);
    expect(result).toEqual({ deleted: true, restaurants: 1 });

    const restaurants = await db.select({ name: restaurant.name }).from(restaurant);
    expect(restaurants.map((row) => row.name)).toEqual(["Someone Else's Café"]);

    const menus = await db.select({ id: menuTable.id }).from(menuTable);
    expect(menus.map((row) => row.id)).toEqual(["menu-other"]);

    const orders = await db.select({ id: orderTable.id }).from(orderTable);
    expect(orders).toHaveLength(0);

    const users = await db.select({ id: userTable.id }).from(userTable);
    expect(users.map((row) => row.id)).toEqual([otherId]);
  });
});

describe("account routes", () => {
  let db: TestDb;
  let ownerId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    ({ db } = await createTestDb());
    holder.db = db;
    ownerId = await seedUser(db, "routes@cafe.test", "Routes Owner");
    holder.userId = ownerId;
    await createRestaurant(db, ownerId, "Routes Café");
  }, 30_000);

  afterEach(() => {
    holder.userId = null;
  });

  it("serves the export as a JSON attachment", async () => {
    const { GET } = await import("@/app/api/account/export/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="eateryo-export-${new Date().toISOString().slice(0, 10)}.json"`
    );
    const body = (await response.json()) as { account: { email: string } };
    expect(body.account.email).toBe("routes@cafe.test");
  });

  it("refuses to delete without the confirmation phrase or from another origin", async () => {
    const { DELETE } = await import("@/app/api/account/route");
    const missing = await DELETE(
      new Request("http://test.local/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "yes" }),
      })
    );
    expect(missing.status).toBe(400);

    const crossOrigin = await DELETE(
      new Request("http://test.local/api/account", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          host: "test.local",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ confirm: "delete my account" }),
      })
    );
    expect(crossOrigin.status).toBe(403);
    expect(holder.userId).not.toBeNull();
  });

  it("deletes the account when confirmed, and 401s when signed out", async () => {
    const { DELETE } = await import("@/app/api/account/route");
    const response = await DELETE(
      new Request("http://test.local/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json", host: "test.local" },
        body: JSON.stringify({ confirm: "delete my account" }),
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true, restaurants: 1 });

    holder.userId = null;
    const signedOut = await DELETE(
      new Request("http://test.local/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json", host: "test.local" },
        body: JSON.stringify({ confirm: "delete my account" }),
      })
    );
    expect(signedOut.status).toBe(401);
  });
});

describe("GET /api/cron/retention", () => {
  let db: TestDb;
  let restaurantId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    ({ db } = await createTestDb());
    holder.db = db;
    const ownerId = await seedUser(db, "cron@cafe.test", "Cron Owner");
    restaurantId = (await createRestaurant(db, ownerId, "Cron Café")).id;
  }, 30_000);

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.ORDER_RETENTION_DAYS;
  });

  function cronRequest(authorization?: string): Request {
    return new Request("http://test.local/api/cron/retention", {
      headers: authorization ? { authorization } : {},
    });
  }

  it("refuses without the secret, even when everything else is fine", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const { GET } = await import("@/app/api/cron/retention/route");
    expect((await GET(cronRequest())).status).toBe(401);
    expect((await GET(cronRequest("Bearer nope"))).status).toBe(401);
    expect((await GET(cronRequest("Bearer cron-secret"))).status).toBe(200);
  });

  it("purges past the configured window and reports what it removed", async () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.ORDER_RETENTION_DAYS = "30";
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await insertOrder(db, restaurantId, old);
    const recentId = await insertOrder(db, restaurantId, new Date());

    const { GET } = await import("@/app/api/cron/retention/route");
    const response = await GET(cronRequest("Bearer cron-secret"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { purged: { orders: number }; days: number };
    expect(body.days).toBe(30);
    expect(body.purged.orders).toBe(1);

    const remaining = await db.select({ id: orderTable.id }).from(orderTable);
    expect(remaining.map((row) => row.id)).toEqual([recentId]);
  });
});
