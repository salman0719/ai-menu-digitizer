import { beforeEach, describe, expect, it } from "vitest";

import { createMenuForUser, deleteMenuForUser } from "@/features/menus/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import {
  consumeOrderRateLimit,
  getOrderForStaff,
  listOrdersForStaff,
  placeOrderFromSlug,
  updateOrderStatusForStaff,
} from "@/features/orders/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { order as orderTable, restaurantMembership } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Step 10 — server orders. These pin the acceptance guarantees:
 * - the server, not the client, decides names, prices, and totals;
 * - an unpriced line makes the whole total null, never a partial sum;
 * - orders are snapshots that survive menu edits and deletion;
 * - tenancy and staff/owner rules hold, and status changes converge through
 *   the server timestamp (a stale write is refused, not applied);
 * - the anonymous endpoint is rate-limited per bucket.
 */
describe("orders repo", () => {
  let db: TestDb;
  let ownerA: string;
  let ownerB: string;
  let restaurantA: string;
  const menuId = "menu-orders-1";

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "orders-owner-a@cafe.test", "Owner A");
    ownerB = await seedUser(db, "orders-owner-b@cafe.test", "Owner B");
    restaurantA = (await createRestaurant(db, ownerA, "Café A")).id;
    await createMenuForUser(db, ownerA, restaurantA, menuDoc());
    await publishMenuForUser(db, ownerA, menuId, { theme: "classic", layout: "list" });
  }, 30_000);

  function menuDoc(): MenuDocument {
    return menuDocumentSchema.parse({
      schemaVersion: 1,
      id: menuId,
      title: "Café A — Orders",
      currency: "USD",
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "cat-drinks",
          name: "Drinks",
          sortOrder: 0,
          items: [
            item({ id: "item-flat", name: "Espresso", price: 3.5 }),
            item({
              id: "item-variant",
              name: "Latte",
              price: null,
              variants: [
                { name: "Small", price: 4 },
                { name: "Large", price: 5 },
              ],
            }),
            item({ id: "item-unpriced", name: "Market soup", price: null }),
            item({ id: "item-soldout", name: "Croissant", price: 2.75, available: false }),
          ],
        },
      ],
    });
  }

  function item(overrides: Record<string, unknown>) {
    return {
      description: null,
      currency: null,
      sortOrder: 0,
      available: true,
      dietaryLabels: [],
      variants: [],
      options: [],
      reviewNotes: [],
      ...overrides,
    };
  }

  function place(lines: { menuItemId: string; variantName?: string | null; quantity: number }[]) {
    return placeOrderFromSlug(db, {
      slug: "cafe-a-orders",
      tableLabel: "7",
      note: "No onions",
      lines,
    });
  }

  async function addStaff(userId: string) {
    await db
      .insert(restaurantMembership)
      .values({ restaurantId: restaurantA, userId, role: "staff" });
    return userId;
  }

  it("copies the published snapshot's names and prices and computes the total", async () => {
    const placed = await place([
      { menuItemId: "item-flat", quantity: 2 },
      { menuItemId: "item-variant", variantName: "Large", quantity: 1 },
    ]);

    expect(placed).toMatchObject({
      tableLabel: "7",
      menuTitle: "Café A — Orders",
      currency: "USD",
      status: "new",
      note: "No onions",
    });
    expect(placed.lines).toEqual([
      { menuItemId: "item-flat", name: "Espresso", variantName: null, unitPrice: 3.5, quantity: 2 },
      {
        menuItemId: "item-variant",
        name: "Latte",
        variantName: "Large",
        unitPrice: 5,
        quantity: 1,
      },
    ]);

    const board = await listOrdersForStaff(db, ownerA);
    expect(board.orders).toHaveLength(1);
    // 2 × 3.50 + 1 × 5.00 = 12.00, computed from stored cents.
    expect(board.orders[0].lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.quantity, 0)).toBe(12);
  });

  it("keeps the total null when any line has no price", async () => {
    const placed = await place([
      { menuItemId: "item-flat", quantity: 1 },
      { menuItemId: "item-unpriced", quantity: 1 },
    ]);
    expect(placed.lines[1].unitPrice).toBeNull();
    const rows = await db.select({ totalCents: orderTable.totalCents }).from(orderTable);
    expect(rows[0]?.totalCents).toBeNull();
  });

  it("rejects requests the client could use to invent menu data", async () => {
    await expect(place([{ menuItemId: "invented", quantity: 1 }])).rejects.toMatchObject({
      code: "unknown_item",
    });
    await expect(place([{ menuItemId: "item-soldout", quantity: 1 }])).rejects.toMatchObject({
      code: "item_unavailable",
    });
    await expect(place([{ menuItemId: "item-variant", quantity: 1 }])).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      place([{ menuItemId: "item-variant", variantName: "Bucket", quantity: 1 }])
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(place([{ menuItemId: "item-flat", quantity: 0 }])).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(place([{ menuItemId: "item-flat", quantity: 21 }])).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(place([])).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses to order from an unpublished menu", async () => {
    await expect(
      placeOrderFromSlug(db, {
        slug: "not-live",
        tableLabel: "1",
        lines: [{ menuItemId: "item-flat", quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "menu_not_live" });
  });

  it("survives menu edits and deletion with its snapshot intact", async () => {
    const placed = await place([{ menuItemId: "item-flat", quantity: 1 }]);
    await deleteMenuForUser(db, ownerA, menuId);

    const board = await listOrdersForStaff(db, ownerA);
    expect(board.orders).toHaveLength(1);
    expect(board.orders[0].id).toBe(placed.id);
    expect(board.orders[0].lines[0].name).toBe("Espresso");
    expect(board.orders[0].menuId).toBeNull();
    expect(board.orders[0].menuTitle).toBe("Café A — Orders");
  });

  it("moves statuses forward only and is idempotent for the same status", async () => {
    const placed = await place([{ menuItemId: "item-flat", quantity: 1 }]);
    const preparing = await updateOrderStatusForStaff(db, ownerA, placed.id, "preparing");
    expect(preparing.status).toBe("preparing");
    expect(preparing.updatedAt > placed.updatedAt).toBe(true);

    const served = await updateOrderStatusForStaff(db, ownerA, placed.id, "served");
    expect(served.status).toBe("served");

    await expect(
      updateOrderStatusForStaff(db, ownerA, placed.id, "preparing")
    ).rejects.toMatchObject({ code: "invalid" });
    // Same status is a safe retry, not an error.
    expect((await updateOrderStatusForStaff(db, ownerA, placed.id, "served")).status).toBe("served");
  });

  it("refuses a stale status write and reports the current order", async () => {
    const placed = await place([{ menuItemId: "item-flat", quantity: 1 }]);
    const first = await updateOrderStatusForStaff(
      db,
      ownerA,
      placed.id,
      "preparing",
      placed.updatedAt
    );

    // A second device still holding the original updatedAt must not overwrite.
    await expect(
      updateOrderStatusForStaff(db, ownerA, placed.id, "cancelled", placed.updatedAt)
    ).rejects.toMatchObject({ code: "stale", current: { status: "preparing" } });

    // With the fresh timestamp the same change is accepted.
    const cancelled = await updateOrderStatusForStaff(
      db,
      ownerA,
      placed.id,
      "cancelled",
      first.updatedAt
    );
    expect(cancelled.status).toBe("cancelled");
  });

  it("returns only orders changed after the cursor, including status edits", async () => {
    const first = await place([{ menuItemId: "item-flat", quantity: 1 }]);
    const initial = await listOrdersForStaff(db, ownerA);
    expect(initial.orders).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await place([{ menuItemId: "item-flat", quantity: 2 }]);
    const incremental = await listOrdersForStaff(db, ownerA, { since: initial.serverTime });
    expect(incremental.orders).toHaveLength(1);

    const afterSecond = (await listOrdersForStaff(db, ownerA)).serverTime;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateOrderStatusForStaff(db, ownerA, first.id, "preparing");
    const statusChange = await listOrdersForStaff(db, ownerA, { since: afterSecond });
    expect(statusChange.orders.map((order) => order.id)).toEqual([first.id]);
    expect(statusChange.orders[0].status).toBe("preparing");
  });

  it("keeps other tenants out and lets staff work the board", async () => {
    const placed = await place([{ menuItemId: "item-flat", quantity: 1 }]);
    await createRestaurant(db, ownerB, "Café B");

    expect(await listOrdersForStaff(db, ownerB)).toEqual({ orders: [], serverTime: expect.any(String) });
    expect(await getOrderForStaff(db, ownerB, placed.id)).toBeNull();
    await expect(
      updateOrderStatusForStaff(db, ownerB, placed.id, "preparing")
    ).rejects.toMatchObject({ code: "not_found" });

    const staff = await addStaff(await seedUser(db, "orders-staff@cafe.test", "Staff"));
    const staffBoard = await listOrdersForStaff(db, staff);
    expect(staffBoard.orders.map((order) => order.id)).toEqual([placed.id]);
    expect((await updateOrderStatusForStaff(db, staff, placed.id, "preparing")).status).toBe(
      "preparing"
    );
  });

  it("counts attempts per bucket and blocks past the limit", async () => {
    const now = new Date("2026-10-18T09:00:00.000Z");
    const results = [];
    for (let attempt = 0; attempt < 14; attempt += 1) {
      results.push(await consumeOrderRateLimit(db, "order:bucket-a:minute-1", now, 12));
    }
    expect(results.filter((result) => result.allowed)).toHaveLength(12);
    expect(results[12]).toMatchObject({ allowed: false, count: 13 });
    // A different bucket (another window or caller) starts fresh.
    expect(
      (await consumeOrderRateLimit(db, "order:bucket-b:minute-1", now, 12)).allowed
    ).toBe(true);
  });
});
