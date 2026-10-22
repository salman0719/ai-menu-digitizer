import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DELETE as unpublish,
  GET as getPublication,
  PATCH as patchPublication,
  POST as publish,
} from "@/app/api/menus/[menuId]/publication/route";
import { POST as countView } from "@/app/api/r/[restaurantSlug]/m/[menuSlug]/view/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser, getMenuForUser, updateMenuForUser } from "@/features/menus/repo";
import {
  getPublicationStatus,
  getPublishedMenuByPath,
} from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for Step 9 publishing (PGlite + real handlers, only the
 * session lookup stubbed). These pin the status codes the UI depends on:
 * 401 signed out, 404 for other tenants, 403 for staff, 400 for bad input,
 * 409 for a taken slug or unpublishing nothing, and 204/404 from the public
 * view beacon.
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

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://test.local/api/menus/menu-1/publication", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function menuParams(menuId: string): { params: Promise<{ menuId: string }> } {
  return { params: Promise.resolve({ menuId }) };
}

function viewParams(
  restaurantSlug: string,
  menuSlug: string
): { params: Promise<{ restaurantSlug: string; menuSlug: string }> } {
  return { params: Promise.resolve({ restaurantSlug, menuSlug }) };
}

const PUBLISH_BODY = { theme: "bistro", layout: "columns" };

let ownerId: string;
let restaurantId: string;
const menuId = "menu-1";

function sampleDoc(title: string): MenuDocument {
  return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id: menuId, title });
}

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "pub-api-owner@cafe.test", "Owner");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Café API")).id;
  await createMenuForUser(holder.db, ownerId, restaurantId, sampleDoc("Café API Menu"));
  holder.userId = ownerId;
}, 30_000);

describe("GET /api/menus/[menuId]/publication", () => {
  it("requires a session", async () => {
    holder.userId = null;
    const res = await getPublication(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
  });

  it("reports null before the first publish", async () => {
    const res = await getPublication(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publication: null });
  });

  it("hides another tenant's menu behind 404", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "outsider@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café");
    holder.userId = outsider;
    const res = await getPublication(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/menus/[menuId]/publication", () => {
  it("publishes and returns the live link", async () => {
    const res = await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publication).toMatchObject({
      restaurantSlug: "cafe-api",
      slug: "cafe-api-menu",
      urlPath: "/r/cafe-api/m/cafe-api-menu",
      isLive: true,
      theme: "bistro",
      layout: "columns",
      hasUnpublishedChanges: false,
    });

    const status = await getPublication(
      new Request("http://test.local"),
      menuParams(menuId)
    ).then((r) => r.json());
    expect(status.publication.isLive).toBe(true);
  });

  it("leaves the public page unchanged until changes are published", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));

    const current = await getMenuForUser(holder.db!, ownerId, menuId);
    await updateMenuForUser(
      holder.db!,
      ownerId,
      menuId,
      { ...current.doc, title: "Edited after publish" },
      current.updatedAt
    );

    const stale = await getPublication(
      new Request("http://test.local"),
      menuParams(menuId)
    ).then((r) => r.json());
    expect(stale.publication.hasUnpublishedChanges).toBe(true);
    expect(
      (await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu"))!.doc.title
    ).toBe("Café API Menu");

    const res = await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    expect((await res.json()).publication.hasUnpublishedChanges).toBe(false);
    expect(
      (await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu"))!.doc.title
    ).toBe("Edited after publish");
  });

  it("rejects bad input and a taken slug", async () => {
    const invalid = await publish(
      jsonRequest("POST", { theme: "neon", layout: "list" }),
      menuParams(menuId)
    );
    expect(invalid.status).toBe(400);

    await publish(jsonRequest("POST", { ...PUBLISH_BODY, slug: "taken" }), menuParams(menuId));

    const secondId = "menu-2";
    await createMenuForUser(holder.db!, ownerId, restaurantId, {
      ...sampleDoc("Second"),
      id: secondId,
    });
    const taken = await publish(
      jsonRequest("POST", { ...PUBLISH_BODY, slug: "taken" }),
      menuParams(secondId)
    );
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("slug_taken");
  });

  it("refuses staff, who may still read", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const staffId = await seedUser(holder.db!, "pub-api-staff@cafe.test", "Staff");
    await holder.db!.insert(restaurantMembership).values({
      restaurantId,
      userId: staffId,
      role: "staff",
    });
    holder.userId = staffId;
    const res = await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/menus/[menuId]/publication", () => {
  it("renames the address and validates it", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));

    const invalid = await patchPublication(
      jsonRequest("PATCH", { slug: "Not A Slug" }),
      menuParams(menuId)
    );
    expect(invalid.status).toBe(400);

    const res = await patchPublication(jsonRequest("PATCH", { slug: "chez-api" }), menuParams(menuId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publication.urlPath).toBe("/r/cafe-api/m/chez-api");
    expect(await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu")).toBeNull();
    expect(await getPublishedMenuByPath(holder.db!, "cafe-api", "chez-api")).not.toBeNull();
  });
});

describe("DELETE /api/menus/[menuId]/publication", () => {
  it("stops serving while keeping the slug reserved", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));

    const res = await unpublish(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(200);
    expect((await res.json()).publication).toMatchObject({
      isLive: false,
      slug: "cafe-api-menu",
    });
    expect(await getPublishedMenuByPath(holder.db!, "cafe-api", "cafe-api-menu")).toBeNull();

    // Deleting twice is safe: the second call reports the same unpublished
    // state instead of failing a retry.
    const again = await unpublish(new Request("http://test.local"), menuParams(menuId));
    expect(again.status).toBe(200);
    expect((await again.json()).publication.isLive).toBe(false);
  });
});

describe("POST /api/r/[restaurantSlug]/m/[menuSlug]/view", () => {
  it("counts only live pages at that exact address", async () => {
    const missing = await countView(
      new Request("http://test.local"),
      viewParams("cafe-api", "nope")
    );
    expect(missing.status).toBe(404);

    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    const wrongRestaurant = await countView(
      new Request("http://test.local"),
      viewParams("another-cafe", "cafe-api-menu")
    );
    expect(wrongRestaurant.status).toBe(404);

    const counted = await countView(
      new Request("http://test.local"),
      viewParams("cafe-api", "cafe-api-menu")
    );
    expect(counted.status).toBe(204);
    expect((await getPublicationStatus(holder.db!, ownerId, menuId))!.viewCount).toBe(1);

    await unpublish(new Request("http://test.local"), menuParams(menuId));
    const dead = await countView(
      new Request("http://test.local"),
      viewParams("cafe-api", "cafe-api-menu")
    );
    expect(dead.status).toBe(404);
  });

  it("needs no session (a diner has no account)", async () => {
    await publish(jsonRequest("POST", PUBLISH_BODY), menuParams(menuId));
    holder.userId = null;
    const res = await countView(
      new Request("http://test.local"),
      viewParams("cafe-api", "cafe-api-menu")
    );
    expect(res.status).toBe(204);
  });
});
