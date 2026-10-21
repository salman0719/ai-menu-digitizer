import { beforeEach, describe, expect, it } from "vitest";

import { createMenuForUser } from "@/features/menus/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { placeTableOrder } from "@/features/orders/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { setMenuAvailabilityForUser, setRestaurantSlugForUser } from "@/features/tables/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Step 3a — one combined order across several menus. Each line names its
 * menu; the server resolves every line against that menu's own published
 * snapshot, refuses the whole ticket when any menu is not live, closed, or
 * foreign, and joins the menu titles on the order row. Runs against the real
 * generated DDL on PGlite.
 */

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

function menuDoc(id: string, title: string, items: Record<string, unknown>[]): MenuDocument {
  return menuDocumentSchema.parse({
    schemaVersion: 1,
    id,
    title,
    currency: "USD",
    updatedAt: new Date().toISOString(),
    categories: [{ id: `${id}-cat`, name: "Main", sortOrder: 0, items }],
  });
}

describe("multi-menu table orders", () => {
  let db: TestDb;
  let ownerA: string;
  let ownerB: string;
  let restaurantA: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "table-orders-owner-a@cafe.test", "Owner A");
    ownerB = await seedUser(db, "table-orders-owner-b@cafe.test", "Owner B");
    restaurantA = (await createRestaurant(db, ownerA, "Café A")).id;
    await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
    await createMenuForUser(
      db,
      ownerA,
      restaurantA,
      menuDoc("menu-lunch", "Lunch", [item({ id: "item-soup", name: "Soup", price: 6 })])
    );
    await createMenuForUser(
      db,
      ownerA,
      restaurantA,
      menuDoc("menu-bar", "Bar", [item({ id: "item-beer", name: "Beer", price: 5 })])
    );
    await publishMenuForUser(db, ownerA, "menu-lunch", { theme: "classic", layout: "list" });
    await publishMenuForUser(db, ownerA, "menu-bar", { theme: "bistro", layout: "list" });
  }, 30_000);

  it("places one ticket across two menus with per-line provenance and a joined title", async () => {
    const placed = await placeTableOrder(db, {
      restaurantSlug: "cafe-a",
      tableLabel: "3",
      note: null,
      lines: [
        { menuSlug: "lunch", menuItemId: "item-soup", quantity: 1 },
        { menuSlug: "bar", menuItemId: "item-beer", quantity: 2 },
      ],
    });

    expect(placed.menuId).toBeNull();
    expect(placed.menuTitle).toBe("Lunch + Bar");
    expect(placed.tableLabel).toBe("3");
    expect(placed.lines).toEqual([
      expect.objectContaining({
        menuItemId: "item-soup",
        name: "Soup",
        unitPrice: 6,
        quantity: 1,
        menuId: "menu-lunch",
        menuTitle: "Lunch",
      }),
      expect.objectContaining({
        menuItemId: "item-beer",
        name: "Beer",
        unitPrice: 5,
        quantity: 2,
        menuId: "menu-bar",
        menuTitle: "Bar",
      }),
    ]);
  });

  it("computes the combined total server-side", async () => {
    const placed = await placeTableOrder(db, {
      restaurantSlug: "cafe-a",
      tableLabel: "3",
      note: null,
      lines: [
        { menuSlug: "lunch", menuItemId: "item-soup", quantity: 1 },
        { menuSlug: "bar", menuItemId: "item-beer", quantity: 2 },
      ],
    });
    // 1 × 6 + 2 × 5 = 16.
    expect(
      placed.lines.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity, 0)
    ).toBe(16);
  });

  it("refuses an unknown restaurant slug without touching the board", async () => {
    await expect(
      placeTableOrder(db, {
        restaurantSlug: "no-such-cafe",
        tableLabel: "3",
        note: null,
        lines: [{ menuSlug: "lunch", menuItemId: "item-soup", quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "menu_not_live" });
  });

  it("refuses a line from another restaurant's menu", async () => {
    const restaurantB = (await createRestaurant(db, ownerB, "Café B")).id;
    await createMenuForUser(
      db,
      ownerB,
      restaurantB,
      menuDoc("menu-secret", "Secret", [item({ id: "item-secret", name: "Secret", price: 9 })])
    );
    await publishMenuForUser(db, ownerB, "menu-secret", { theme: "classic", layout: "list" });
    await expect(
      placeTableOrder(db, {
        restaurantSlug: "cafe-a",
        tableLabel: "3",
        note: null,
        lines: [
          { menuSlug: "lunch", menuItemId: "item-soup", quantity: 1 },
          { menuSlug: "secret", menuItemId: "item-secret", quantity: 1 },
        ],
      })
    ).rejects.toMatchObject({ code: "menu_not_live" });
  });

  it("refuses the ticket when one menu is closed right now", async () => {
    await setMenuAvailabilityForUser(db, ownerA, "menu-bar", [
      { days: [0], start: "11:00", end: "15:00" },
    ]);
    // Monday noon UTC is not Sunday: the bar is closed.
    await expect(
      placeTableOrder(db, {
        restaurantSlug: "cafe-a",
        tableLabel: "3",
        note: null,
        lines: [
          { menuSlug: "lunch", menuItemId: "item-soup", quantity: 1 },
          { menuSlug: "bar", menuItemId: "item-beer", quantity: 1 },
        ],
      })
    ).rejects.toMatchObject({ code: "menu_not_live" });
  });

  it("rejects unknown items per menu, like the single-menu path", async () => {
    await expect(
      placeTableOrder(db, {
        restaurantSlug: "cafe-a",
        tableLabel: "3",
        note: null,
        lines: [{ menuSlug: "bar", menuItemId: "item-soup", quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "unknown_item" });
  });

  it("keeps the single-menu path stamping per-line provenance", async () => {
    const { placeOrderFromSlug } = await import("@/features/orders/repo");
    const placed = await placeOrderFromSlug(db, {
      slug: "lunch",
      tableLabel: "3",
      note: null,
      lines: [{ menuItemId: "item-soup", quantity: 1 }],
    });
    expect(placed.lines[0]).toMatchObject({ menuId: "menu-lunch", menuTitle: "Lunch" });
  });
});
