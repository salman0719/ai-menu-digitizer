import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as applyProposal } from "@/app/api/assistant/apply/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import {
  createMenuForUser,
  getMenuForUser,
  updateMenuForUser,
  type ServerMenu,
} from "@/features/menus/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { menuRevision, restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP tests for POST /api/assistant/apply (A2). Real handlers and the real
 * generated schema (PGlite); only the session and the DB accessor are stubbed.
 * The provider is never imported by this route, which the fetch assertion
 * proves: approval is free and deterministic.
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

const fetchMock = vi.fn<typeof fetch>();

async function initTestDb(): Promise<TestDb> {
  const { createTestDb } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  return db;
}

beforeEach(async () => {
  holder.db = await initTestDb();
  holder.userId = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
}, 30_000);

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/api/assistant/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "test.local",
      "x-request-id": "req-apply-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function seedOwnerWithMenu(): Promise<{
  userId: string;
  restaurantId: string;
  menu: ServerMenu;
  breakfastId: string;
}> {
  const { seedUser } = await import("./helpers/pg-test-db");
  const userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
  holder.userId = userId;
  const restaurant = await createRestaurant(holder.db!, userId, "Sunny Side Café");
  const menu = await createMenuForUser(
    holder.db!,
    userId,
    restaurant.id,
    createSampleMenuDocument()
  );
  const breakfast = menu.doc.categories.find((category) => category.name === "Breakfast");
  if (!breakfast) throw new Error("fixture menu has no Breakfast category");
  return { userId, restaurantId: restaurant.id, menu, breakfastId: breakfast.id };
}

describe("POST /api/assistant/apply", () => {
  it("returns 401 when signed out", async () => {
    const response = await applyProposal(
      request({ menuId: "m", expectedUpdatedAt: "x", operations: [] })
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin approval", async () => {
    const { menu, breakfastId } = await seedOwnerWithMenu();
    const response = await applyProposal(
      request(
        {
          menuId: menu.id,
          expectedUpdatedAt: menu.updatedAt,
          operations: [{ op: "add_item", categoryId: breakfastId, name: "Tea", price: 2 }],
        },
        { origin: "https://evil.example" }
      )
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("cross_origin_rejected");
  });

  it("returns 403 for staff, who are read-only", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const { restaurantId, menu, breakfastId } = await seedOwnerWithMenu();
    const staffId = await seedUser(holder.db!, "staff@cafe.test", "Staff");
    await holder.db!.insert(restaurantMembership).values({
      restaurantId,
      userId: staffId,
      role: "staff",
    });
    holder.userId = staffId;

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [{ op: "add_item", categoryId: breakfastId, name: "Tea", price: 2 }],
      })
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    const unchanged = await getMenuForUser(holder.db!, staffId, menu.id);
    expect(unchanged.updatedAt).toBe(menu.updatedAt);
  });

  it("404s a menu from another tenant instead of leaking that it exists", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const { menu, breakfastId } = await seedOwnerWithMenu();
    holder.userId = await seedUser(holder.db!, "stranger@cafe.test", "Stranger");

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [{ op: "add_item", categoryId: breakfastId, name: "Tea", price: 2 }],
      })
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("applies an approved change and returns the diff", async () => {
    const { userId, menu, breakfastId } = await seedOwnerWithMenu();

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [
          { op: "add_item", categoryId: breakfastId, name: "Green tea", price: 3.25 },
          { op: "add_category", name: "Specials" },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.preview.before).toMatchObject({ categories: 2, items: 4 });
    expect(payload.preview.after).toMatchObject({ categories: 3, items: 5 });
    expect(payload.preview.operations).toHaveLength(2);
    expect(payload.menu.updatedAt).not.toBe(menu.updatedAt);

    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(
      stored.doc.categories
        .find((category) => category.name === "Breakfast")
        ?.items.some((item) => item.name === "Green tea")
    ).toBe(true);
    expect(stored.doc.categories.map((category) => category.name)).toContain("Specials");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409s a stale approval and hands back the current revision", async () => {
    const { userId, menu, breakfastId } = await seedOwnerWithMenu();
    const newer = await updateMenuForUser(
      holder.db!,
      userId,
      menu.id,
      { ...menu.doc, title: "Renamed elsewhere" },
      menu.updatedAt
    );

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [{ op: "add_item", categoryId: breakfastId, name: "Tea", price: 2 }],
      })
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("stale_menu");
    expect(payload.error.currentUpdatedAt).toBe(newer.updatedAt);
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.updatedAt).toBe(newer.updatedAt);
  });

  it("rejects unknown ids with 400 and writes nothing", async () => {
    const { userId, menu } = await seedOwnerWithMenu();

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [{ op: "update_item", itemId: "invented", price: 1 }],
      })
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error.code).toBe("invalid_operations");
    expect(payload.error.reason).toBe("unknown_item");
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.updatedAt).toBe(menu.updatedAt);
  });

  it("refuses an invented price instead of writing null", async () => {
    const { userId, menu, breakfastId } = await seedOwnerWithMenu();

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [
          { op: "add_item", categoryId: breakfastId, name: "Mystery dish", price: null },
        ],
      })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.reason).toBe("missing_price");
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.doc.categories.flatMap((category) => category.items)).toHaveLength(4);
  });

  it("never touches the published revision", async () => {
    const { userId, restaurantId, menu, breakfastId } = await seedOwnerWithMenu();
    await holder.db!.insert(menuRevision).values({
      menuId: menu.id,
      restaurantId,
      doc: menu.doc,
      theme: "classic",
      layout: "list",
      sourceUpdatedAt: new Date(menu.updatedAt),
    });

    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [{ op: "add_item", categoryId: breakfastId, name: "Green tea", price: 3.25 }],
      })
    );
    expect(response.status).toBe(200);

    const revisions = await holder.db!.select().from(menuRevision);
    expect(revisions).toHaveLength(1);
    const snapshot = revisions[0].doc as {
      categories: Array<{ items: unknown[] }>;
    };
    expect(snapshot.categories.flatMap((category) => category.items)).toHaveLength(4);
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.doc.categories.flatMap((category) => category.items)).toHaveLength(5);
  });

  it("rejects an approval body with unexpected keys", async () => {
    const { menu, breakfastId } = await seedOwnerWithMenu();
    const response = await applyProposal(
      request({
        menuId: menu.id,
        expectedUpdatedAt: menu.updatedAt,
        operations: [{ op: "add_item", categoryId: breakfastId, name: "Tea", price: 2 }],
        doc: { title: "Smuggled" },
      })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_body");
  });
});
