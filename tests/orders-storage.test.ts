import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabase, DB_NAME, idbPut, ORDERS_STORE, tx } from "../src/features/menu/indexeddb";
import {
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  OrderStorageError,
  updateOrderStatus,
} from "../src/features/orders/storage";

function resetDatabase(): Promise<void> {
  closeDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(() => resetDatabase());
afterEach(() => closeDatabase());

function line(overrides: Partial<Parameters<typeof createOrder>[0]["lines"][number]> = {}) {
  return {
    menuItemId: "item-1",
    name: "Espresso",
    variantName: "Small" as string | null,
    unitPrice: 2 as number | null,
    quantity: 2,
    menuId: null as string | null,
    menuTitle: null as string | null,
    ...overrides,
  };
}

describe("order storage", () => {
  it("creates orders in new status and lists them newest first", async () => {
    const first = await createOrder({
      menuId: "menu-1",
      menuTitle: "Café",
      tableLabel: " 3 ",
      currency: "$",
      note: "  no sugar ",
      lines: [line()],
    });
    // Force a distinct, later timestamp for ordering.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createOrder({
      menuId: "menu-1",
      menuTitle: "Café",
      tableLabel: "4",
      currency: "$",
      note: null,
      lines: [line({ menuItemId: "item-2", name: "Latte" })],
    });

    expect(first.status).toBe("new");
    expect(first.tableLabel).toBe("3");
    expect(first.note).toBe("no sugar");

    const { orders, corruptCount } = await listOrders();
    expect(corruptCount).toBe(0);
    expect(orders.map((order) => order.id)).toEqual([second.id, first.id]);
  });

  it("updates status and stamps updatedAt", async () => {
    const order = await createOrder({
      menuId: "menu-1",
      menuTitle: "Café",
      tableLabel: "1",
      currency: null,
      note: null,
      lines: [line()],
    });
    const preparing = await updateOrderStatus(order.id, "preparing");
    expect(preparing.status).toBe("preparing");
    expect(preparing.updatedAt >= order.updatedAt).toBe(true);
    expect((await getOrder(order.id)).status).toBe("preparing");
  });

  it("deletes orders and reports missing ones", async () => {
    const order = await createOrder({
      menuId: "menu-1",
      menuTitle: "Café",
      tableLabel: "1",
      currency: null,
      note: null,
      lines: [line()],
    });
    await deleteOrder(order.id);
    const error = await getOrder(order.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderStorageError);
    expect((error as OrderStorageError).code).toBe("not_found");
  });

  it("refuses invalid orders and reports corrupt records", async () => {
    const invalid = await createOrder({
      menuId: "menu-1",
      menuTitle: "Café",
      tableLabel: "1",
      currency: null,
      note: null,
      lines: [],
    }).catch((e: unknown) => e);
    expect(invalid).toBeInstanceOf(OrderStorageError);
    expect((invalid as OrderStorageError).code).toBe("corrupt");

    await tx(ORDERS_STORE, "readwrite", ([store]) =>
      idbPut(store, { id: "broken", menuId: "menu-1" })
    );
    const { orders, corruptCount } = await listOrders();
    expect(orders).toHaveLength(0);
    expect(corruptCount).toBe(1);
  });
});
