import { describe, expect, it } from "vitest";

import { detectNewOrders, mergeBoardOrders } from "@/features/orders/monitor-utils";
import type { Order } from "@/features/orders/schema";

/**
 * R0.3 — the app-wide order monitor shares one poller (and one cursor) with
 * the board. These pin the shared list logic: guarded ids (a status PATCH
 * in flight) are never overwritten by a poll, the board stays newest-first,
 * and only genuinely new arrivals — status `new`, created after the last
 * seen moment — ever badge, toast, or chime.
 */

function order(overrides: Partial<Order> & { id: string }): Order {
  return {
    menuId: "menu-1",
    menuTitle: "Bistro Four",
    tableLabel: "3",
    currency: "USD",
    note: null,
    lines: [
      {
        menuItemId: "item-1",
        name: "Flat white",
        variantName: null,
        unitPrice: 4.5,
        quantity: 1,
        menuId: null,
        menuTitle: null,
      },
    ],
    status: "new",
    createdAt: "2026-10-24T10:00:00.000Z",
    updatedAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeBoardOrders", () => {
  it("adds newcomers and stays newest-first", () => {
    const old = order({ id: "a", createdAt: "2026-10-24T10:00:00.000Z" });
    const fresh = order({ id: "b", createdAt: "2026-10-24T10:05:00.000Z" });
    const merged = mergeBoardOrders([old], [old, fresh], new Set());
    expect(merged.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("adopts server updates for unguarded orders", () => {
    const current = order({ id: "a", status: "new" });
    const incoming = order({ id: "a", status: "preparing" });
    const merged = mergeBoardOrders([current], [incoming], new Set());
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("preparing");
  });

  it("never overwrites an order with a status change in flight", () => {
    const current = order({ id: "a", status: "preparing" });
    const incoming = order({ id: "a", status: "served" });
    const merged = mergeBoardOrders([current], [incoming], new Set(["a"]));
    expect(merged[0]?.status).toBe("preparing");
  });
});

describe("detectNewOrders", () => {
  it("returns only new orders created after the last seen moment", () => {
    const seenAt = "2026-10-24T10:03:00.000Z";
    const arrived = order({ id: "b", createdAt: "2026-10-24T10:05:00.000Z", status: "new" });
    const older = order({ id: "a", createdAt: "2026-10-24T10:01:00.000Z", status: "new" });
    const moved = order({ id: "c", createdAt: "2026-10-24T10:06:00.000Z", status: "preparing" });
    expect(detectNewOrders([arrived, older, moved], seenAt).map((entry) => entry.id)).toEqual([
      "b",
    ]);
  });

  it("treats a null seen moment as everything new (first run after sign-in)", () => {
    const fresh = order({ id: "b", status: "new" });
    expect(detectNewOrders([fresh], null).map((entry) => entry.id)).toEqual(["b"]);
  });
});
