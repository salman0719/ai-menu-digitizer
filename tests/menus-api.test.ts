import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as createMenu, GET as listMenus } from "@/app/api/menus/route";
import {
  DELETE as deleteMenu,
  GET as getMenu,
  PUT as putMenu,
} from "@/app/api/menus/[menuId]/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { createRestaurant } from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for /api/menus (Step 8). The real route handlers run
 * against the real generated schema (PGlite), with only the session lookup
 * stubbed — so auth/tenancy/validation/conflict behaviour is exercised end
 * to end through fetch-level Request/Response objects. `vi.mock` is hoisted
 * by vitest above the imports; the factories only dereference `holder`
 * inside lazy closures, when handlers actually run.
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

function asRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://test.local${url}`, init);
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return asRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Next 16 route handlers receive `{ params: Promise<...> }` as their second
 * argument (dynamic segments are async); tests must supply it explicitly.
 */
function menuParams(menuId: string): { params: Promise<{ menuId: string }> } {
  return { params: Promise.resolve({ menuId }) };
}

beforeEach(async () => {
  holder.db = await initTestDb();
  holder.userId = null;
});

describe("GET /api/menus", () => {
  it("returns 401 with the shared error shape when signed out", async () => {
    const res = await listMenus();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("lists only the caller's menus", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    holder.userId = userId;
    const { id: restaurantId } = await createRestaurant(holder.db!, userId, "Sunny Side Café");
    const created = await createMenu(
      jsonRequest("/api/menus", "POST", {
        restaurantId,
        doc: createSampleMenuDocument(),
      })
    );
    expect(created.status).toBe(201);

    // A second, unrelated tenant's menu must never appear in the listing.
    const stranger = await seedUser(holder.db!, "stranger@cafe.test", "Stranger");
    const { id: strangerRestaurant } = await createRestaurant(holder.db!, stranger, "Other Place");
    holder.userId = stranger;
    const strangerCreate = await createMenu(
      jsonRequest("/api/menus", "POST", {
        restaurantId: strangerRestaurant,
        doc: createSampleMenuDocument(),
      })
    );
    expect(strangerCreate.status).toBe(201);

    holder.userId = userId;
    const res = await listMenus();
    expect(res.status).toBe(200);
    // Personalized data must never be cached.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const payload = await res.json();
    expect(payload.menus).toHaveLength(1);
    expect(payload.menus[0].restaurantId).toBe(restaurantId);
    expect(typeof payload.menus[0].title).toBe("string");
  });
});

describe("POST /api/menus", () => {
  it("rejects an invalid body with 400 and a field message", async () => {
    holder.userId = "u1";
    const res = await createMenu(jsonRequest("/api/menus", "POST", { restaurantId: "", doc: null }));
    expect(res.status).toBe(400);
    const payload = await res.json();
    expect(payload.error.code).toBe("invalid_body");
    expect(payload.error.message).toMatch(/expected string/i);
  });
});

describe("GET/PUT /api/menus/[menuId]", () => {
  it("round-trips a menu and rejects a stale updatedAt with 409 + current revision", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    holder.userId = userId;
    const { id: restaurantId } = await createRestaurant(holder.db!, userId, "Sunny Side Café");
    const doc = createSampleMenuDocument();

    const createdRes = await createMenu(
      jsonRequest("/api/menus", "POST", { restaurantId, doc })
    );
    expect(createdRes.status).toBe(201);
    const { menu } = await createdRes.json();

    // Any member may read…
    const readRes = await getMenu(asRequest(`/api/menus/${menu.id}`), menuParams(menu.id));
    expect(readRes.status).toBe(200);
    expect(readRes.headers.get("Cache-Control")).toBe("no-store");
    const { menu: fetched } = await readRes.json();
    expect(fetched.doc.title).toBe(doc.title);
    expect(fetched.updatedAt).toBe(menu.updatedAt);

    // …and write: a matching updatedAt moves the revision forward.
    const edited = { ...fetched.doc, title: "Renamed over HTTP" };
    const okRes = await putMenu(
      jsonRequest(`/api/menus/${menu.id}`, "PUT", {
        expectedUpdatedAt: menu.updatedAt,
        doc: edited,
      }),
      menuParams(menu.id)
    );
    expect(okRes.status).toBe(200);
    const { menu: updated } = await okRes.json();
    expect(updated.doc.title).toBe("Renamed over HTTP");

    // A stale token (the one the first client still holds) must 409 and
    // hand back the current revision for re-basing.
    const staleRes = await putMenu(
      jsonRequest(`/api/menus/${menu.id}`, "PUT", {
        expectedUpdatedAt: menu.updatedAt,
        doc: edited,
      }),
      menuParams(menu.id)
    );
    expect(staleRes.status).toBe(409);
    const conflict = await staleRes.json();
    expect(conflict.error.code).toBe("stale_menu");
    // The current revision rides along inside the error envelope so the
    // client can offer an explicit reload/re-base.
    expect(conflict.error.currentUpdatedAt).toBe(updated.updatedAt);
  });

  it("404s across tenants, even for signed-in users", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const ownerId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    const { id: restaurantId } = await createRestaurant(holder.db!, ownerId, "Sunny Side Café");
    holder.userId = ownerId;
    const createdRes = await createMenu(
      jsonRequest("/api/menus", "POST", { restaurantId, doc: createSampleMenuDocument() })
    );
    const { menu } = await createdRes.json();

    holder.userId = await seedUser(holder.db!, "stranger@cafe.test", "Stranger");
    expect((await getMenu(asRequest(`/api/menus/${menu.id}`), menuParams(menu.id))).status).toBe(404);
    expect(
      (
        await deleteMenu(
          asRequest(`/api/menus/${menu.id}`, { method: "DELETE" }),
          menuParams(menu.id)
        )
      ).status
    ).toBe(404);
  });
});

describe("DELETE /api/menus/[menuId]", () => {
  it("deletes an owned menu (204), after which it is gone", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const userId = await seedUser(holder.db!, "owner@cafe.test", "Owner");
    holder.userId = userId;
    const { id: restaurantId } = await createRestaurant(holder.db!, userId, "Sunny Side Café");
    const createdRes = await createMenu(
      jsonRequest("/api/menus", "POST", { restaurantId, doc: createSampleMenuDocument() })
    );
    const { menu } = await createdRes.json();

    const delRes = await deleteMenu(
      asRequest(`/api/menus/${menu.id}`, { method: "DELETE" }),
      menuParams(menu.id)
    );
    expect(delRes.status).toBe(204);
    expect((await getMenu(asRequest(`/api/menus/${menu.id}`), menuParams(menu.id))).status).toBe(404);
  });
});
