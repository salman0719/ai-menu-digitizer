import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getOrders, POST as placeOrderRoute } from "@/app/api/orders/route";
import { PATCH as patchOrder } from "@/app/api/orders/[orderId]/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { order as orderTable, restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for Step 10 (PGlite + real handlers, session stubbed).
 *
 * They pin the guarantees a public endpoint must hold: names/prices/totals
 * come from the server, malformed or oversized bodies are refused, the
 * honeypot writes nothing, the rate limiter answers 429, and a stale status
 * write returns 409 with the current order instead of overwriting.
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
let restaurantId: string;
let callerCounter = 0;
/** The exact document that was stored + published (ids are random per build). */
let publishedDoc: MenuDocument;
const menuId = "menu-api-orders";

function menuDoc(): MenuDocument {
  return menuDocumentSchema.parse({
    ...createSampleMenuDocument(),
    id: menuId,
    title: "Café API — Orders",
    currency: "USD",
  });
}

/** Unique caller address per request so rate-limit tests stay isolated. */
function callerHeaders(ip = `10.0.0.${(callerCounter += 1)}`): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": ip };
}

function orderRequest(
  body: unknown,
  ip?: string,
  extraHeaders: Record<string, string> = {}
): Request {
  return new Request("http://test.local/api/orders", {
    method: "POST",
    headers: { ...callerHeaders(ip), ...extraHeaders },
    body: JSON.stringify(body),
  });
}

const validBody = {
  slug: "cafe-api-orders",
  tableLabel: "4",
  note: "Allergy: nuts",
  lines: [{ menuItemId: "nope", quantity: 1 }],
};

function bodyWithLine(overrides: Partial<typeof validBody> = {}) {
  return { ...validBody, ...overrides };
}

function orderParams(orderId: string): { params: Promise<{ orderId: string }> } {
  return { params: Promise.resolve({ orderId }) };
}

function patchRequest(body: unknown): Request {
  return new Request("http://test.local/api/orders/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A line the published snapshot will accept (picks a size when needed). */
function sampleLine(quantity = 1) {
  const item = publishedDoc.categories
    .flatMap((category) => category.items)
    .find((candidate) => candidate.available !== false)!;
  return {
    menuItemId: item.id,
    ...(item.variants.length > 0 ? { variantName: item.variants[0].name } : {}),
    quantity,
  };
}

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "orders-api-owner@cafe.test", "Owner");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Café API")).id;
  publishedDoc = menuDoc();
  await createMenuForUser(holder.db, ownerId, restaurantId, publishedDoc);
  await publishMenuForUser(holder.db, ownerId, menuId, { theme: "classic", layout: "list" });
  holder.userId = ownerId;
}, 30_000);

describe("POST /api/orders", () => {
  it("places an anonymous order with server-resolved names and prices", async () => {
    holder.userId = null; // a diner has no account

    const res = await placeOrderRoute(
      orderRequest({
        ...bodyWithLine({ lines: [sampleLine(2)] }),
        // Client attempts to inject values the server must ignore.
        name: "Free lunch",
        unitPrice: 0,
        total: 0,
      })
    );
    expect(res.status).toBe(201);
    const { order } = await res.json();
    expect(order.status).toBe("new");
    expect(order.tableLabel).toBe("4");
    expect(order.lines[0].menuItemId).toBe(sampleLine().menuItemId);
    expect(order.lines[0].quantity).toBe(2);
    expect(order.lines[0].name).not.toBe("Free lunch");
    const rows = await holder.db!.select({ total: orderTable.totalCents }).from(orderTable);
    expect(rows[0].total).not.toBe(0);
  });

  it("refuses an unpublished menu and unknown items", async () => {
    const missing = await placeOrderRoute(orderRequest(bodyWithLine({ slug: "not-live" })));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("menu_not_live");

    const unknown = await placeOrderRoute(
      orderRequest(bodyWithLine({ lines: [{ menuItemId: "invented", quantity: 1 }] }))
    );
    expect(unknown.status).toBe(409);
    expect((await unknown.json()).error.code).toBe("unknown_item");
  });

  it("silently refuses the honeypot and never stores an order", async () => {
    const res = await placeOrderRoute(
      orderRequest({
        ...bodyWithLine({ lines: [sampleLine()] }),
        website: "https://spam.example",
      })
    );
    expect(res.status).toBe(400);
    const rows = await holder.db!.select({ id: orderTable.id }).from(orderTable);
    expect(rows).toHaveLength(0);
  });

  it("rejects an oversized payload before parsing it", async () => {
    const res = await placeOrderRoute(orderRequest(bodyWithLine(), undefined, { "content-length": "99999" }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("payload_too_large");
  });

  it("rate-limits repeated attempts and says when to retry", async () => {
    const line = sampleLine();
    const ip = "203.0.113.9";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const res = await placeOrderRoute(
        orderRequest(bodyWithLine({ lines: [line] }), ip)
      );
      expect(res.status).toBe(201);
    }
    const blocked = await placeOrderRoute(
      orderRequest(bodyWithLine({ lines: [line] }), ip)
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect((await blocked.json()).error.code).toBe("rate_limited");
    // Another address is unaffected.
    const other = await placeOrderRoute(
      orderRequest(bodyWithLine({ lines: [line] }))
    );
    expect(other.status).toBe(201);
  });
});

describe("GET /api/orders", () => {
  async function placeOne(): Promise<string> {
    holder.userId = null;
    const res = await placeOrderRoute(
      orderRequest(
        bodyWithLine({ lines: [sampleLine()] })
      )
    );
    holder.userId = ownerId;
    return (await res.json()).order.id;
  }

  it("requires a session", async () => {
    holder.userId = null;
    const res = await getOrders(new Request("http://test.local/api/orders"));
    expect(res.status).toBe(401);
  });

  it("returns the board and incremental changes only", async () => {
    const firstId = await placeOne();
    const initial = await getOrders(new Request("http://test.local/api/orders"));
    expect(initial.status).toBe(200);
    const board = await initial.json();
    expect(board.orders.map((order: { id: string }) => order.id)).toEqual([firstId]);

    const updated = await patchOrder(
      patchRequest({ status: "preparing", expectedUpdatedAt: board.orders[0].updatedAt }),
      orderParams(firstId)
    );
    expect(updated.status).toBe(200);

    const incremental = await getOrders(
      new Request(`http://test.local/api/orders?since=${encodeURIComponent(board.serverTime)}`)
    );
    const changed = await incremental.json();
    expect(changed.orders).toHaveLength(1);
    expect(changed.orders[0].status).toBe("preparing");

    const nothingNew = await getOrders(
      new Request(`http://test.local/api/orders?since=${encodeURIComponent(changed.serverTime)}`)
    );
    expect((await nothingNew.json()).orders).toHaveLength(0);
  });

  it("keeps other tenants out and lets staff read", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    await placeOne();

    const outsider = await seedUser(holder.db!, "orders-api-outsider@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café");
    holder.userId = outsider;
    expect((await (await getOrders(new Request("http://test.local/api/orders"))).json()).orders).toHaveLength(0);
    const foreign = await getOrders(
      new Request(`http://test.local/api/orders?restaurantId=${restaurantId}`)
    );
    expect(foreign.status).toBe(404);

    const staffId = await seedUser(holder.db!, "orders-api-staff@cafe.test", "Staff");
    await holder.db!.insert(restaurantMembership).values({
      restaurantId,
      userId: staffId,
      role: "staff",
    });
    holder.userId = staffId;
    const staffBoard = await (await getOrders(new Request("http://test.local/api/orders"))).json();
    expect(staffBoard.orders).toHaveLength(1);
  });
});

describe("PATCH /api/orders/[orderId]", () => {
  async function placeOne() {
    holder.userId = null;
    const res = await placeOrderRoute(
      orderRequest(
        bodyWithLine({ lines: [sampleLine()] })
      )
    );
    holder.userId = ownerId;
    return (await res.json()).order as { id: string; updatedAt: string };
  }

  it("moves status forward and refuses a stale write with the current order", async () => {
    const placed = await placeOne();

    const moved = await patchOrder(
      patchRequest({ status: "preparing", expectedUpdatedAt: placed.updatedAt }),
      orderParams(placed.id)
    );
    expect(moved.status).toBe(200);

    const stale = await patchOrder(
      patchRequest({ status: "cancelled", expectedUpdatedAt: placed.updatedAt }),
      orderParams(placed.id)
    );
    expect(stale.status).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.error.code).toBe("order_stale");
    expect(staleBody.error.order.status).toBe("preparing");
  });

  it("rejects invalid transitions and unknown orders", async () => {
    const placed = await placeOne();
    // Skipping a step is not a valid transition (new may only go to preparing
    // or cancelled); the same status is an idempotent retry, not an error.
    const skipped = await patchOrder(
      patchRequest({ status: "served" }),
      orderParams(placed.id)
    );
    expect(skipped.status).toBe(400);

    const unknown = await patchOrder(patchRequest({ status: "served" }), orderParams("nope"));
    expect(unknown.status).toBe(404);
  });

  it("keeps other tenants out", async () => {
    const placed = await placeOne();
    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "orders-api-outsider2@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café 2");
    holder.userId = outsider;

    const res = await patchOrder(patchRequest({ status: "preparing" }), orderParams(placed.id));
    expect(res.status).toBe(404);
  });
});
