import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as placeOrderRoute } from "@/app/api/orders/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import type { OrderEmailOutcome } from "@/features/orders/order-mailer";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * R0.4b — the post-placement email hook at the HTTP surface. The hook
 * itself is stubbed (capture + failure injection); the route, prefs, and
 * gating are real. Pins the best-effort contract: the hook runs with the
 * placed order's restaurant, and a failed hook still answers 201.
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

const hook: {
  calls: { restaurantId: string; restaurantName: string }[];
  failNext: boolean;
} = { calls: [], failNext: false };

vi.mock("@/features/orders/order-mailer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/orders/order-mailer")>();
  return {
    ...original,
    maybeEmailNewOrder: vi.fn(
      async (
        _db: unknown,
        order: { id: string },
        restaurantId: string,
        restaurantName: string
      ): Promise<OrderEmailOutcome> => {
        hook.calls.push({ restaurantId, restaurantName });
        if (hook.failNext) return { mailed: false, skipped: "failed" as const };
        return { mailed: true };
      }
    ),
  };
});

async function initTestDb(): Promise<TestDb> {
  const { createTestDb } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  return db;
}

let ownerId: string;
let restaurantId: string;
let publishedDoc: MenuDocument;
const menuId = "menu-email-orders";
let callerCounter = 100;

function orderRequest(body: unknown): Request {
  callerCounter += 1;
  return new Request("http://test.local/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.9.0.${callerCounter}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "orders-email-owner@cafe.test", "Owner");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Cafe Email")).id;
  publishedDoc = menuDocumentSchema.parse({
    ...createSampleMenuDocument(),
    id: menuId,
    title: "Cafe Email Orders",
    currency: "USD",
  });
  await createMenuForUser(holder.db, ownerId, restaurantId, publishedDoc);
  await publishMenuForUser(holder.db, ownerId, menuId, { theme: "classic", layout: "list" });
  holder.userId = null; // diners are anonymous
  hook.calls = [];
  hook.failNext = false;
}, 30_000);

function validBody() {
  const item = publishedDoc.categories
    .flatMap((category) => category.items)
    .find((candidate) => candidate.available !== false)!;
  return {
    restaurantSlug: "cafe-email",
    slug: "cafe-email-orders",
    tableLabel: "4",
    note: null,
    lines: [
      {
        menuItemId: item.id,
        ...(item.variants.length > 0 ? { variantName: item.variants[0]!.name } : {}),
        quantity: 1,
      },
    ],
  };
}

describe("POST /api/orders new-order email hook", () => {
  it("runs the hook with the placed order's restaurant", async () => {
    const res = await placeOrderRoute(orderRequest(validBody()));
    expect(res.status).toBe(201);
    expect(hook.calls).toEqual([{ restaurantId, restaurantName: "Cafe Email" }]);
  });

  it("still answers 201 when the hook reports failure", async () => {
    hook.failNext = true;
    const res = await placeOrderRoute(orderRequest(validBody()));
    expect(res.status).toBe(201);
    expect(hook.calls).toHaveLength(1);
  });
});
