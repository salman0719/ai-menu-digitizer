import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as publishSetup } from "@/app/api/menus/[menuId]/publish-setup/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser, getMenuForUser, listMenusForUser } from "@/features/menus/repo";
import { getPublishedMenuByPath, publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant, listRestaurantsForUser } from "@/features/tenancy/repo";
import { restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * R1 publish setup: one submit from a browser-only draft to a live link.
 *
 * These tests use the real PGlite schema and the real route handler, with
 * only the session lookup and the DB singleton stubbed. They pin the two
 * things that matter for the onboarding promise: the restaurant is created
 * exactly once (and only when the owner has none), and retrying a partial
 * attempt is safe.
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
  return (await createTestDb()).db;
}

const OWNER_EMAIL = "setup-owner@cafe.test";
const MENU_ID = "setup-menu-1";

function sampleDoc(title: string, id = MENU_ID): MenuDocument {
  return menuDocumentSchema.parse({
    ...createSampleMenuDocument(),
    id,
    title,
  });
}

function jsonRequest(body: unknown, origin = "http://test.local"): Request {
  return new Request("http://test.local/api/menus/menu-1/publish-setup", {
    method: "POST",
    headers: { "content-type": "application/json", host: "test.local", origin },
    body: JSON.stringify(body),
  });
}

function menuParams(menuId = MENU_ID): { params: Promise<{ menuId: string }> } {
  return { params: Promise.resolve({ menuId }) };
}

const PUBLISH_STYLE = { theme: "bistro", layout: "columns" } as const;

let ownerId: string;

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, OWNER_EMAIL, "Owner");
  holder.userId = ownerId;
}, 30_000);

describe("POST /api/menus/[menuId]/publish-setup", () => {
  it("creates the restaurant, attaches the draft and publishes it", async () => {
    const doc = sampleDoc("Sunny Side Café — Lunch");
    const res = await publishSetup(
      jsonRequest({
        doc,
        restaurantName: "Sunny Side Café",
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toEqual({ restaurant: true, menu: true });
    expect(body.restaurant.name).toBe("Sunny Side Café");
    expect(body.publication).toMatchObject({
      restaurantSlug: "sunny-side-cafe",
      isLive: true,
      theme: "bistro",
      layout: "columns",
    });
    expect(body.publication.urlPath).toMatch(/^\/r\/sunny-side-cafe\/m\//);

    expect(await listRestaurantsForUser(holder.db!, ownerId)).toHaveLength(1);
    expect(await listMenusForUser(holder.db!, ownerId)).toHaveLength(1);
    const live = await getPublishedMenuByPath(
      holder.db!,
      body.publication.restaurantSlug,
      body.publication.slug
    );
    expect(live?.doc.id).toBe(MENU_ID);
    expect(live?.doc.title).toBe("Sunny Side Café — Lunch");
  });

  it("uses the owner's existing restaurant instead of adding another", async () => {
    const existing = await createRestaurant(holder.db!, ownerId, "Existing Café");
    const res = await publishSetup(
      jsonRequest({
        doc: sampleDoc("Lunch"),
        // The wizard prefills a name; with one owned restaurant the id is
        // what counts and no second café is created.
        restaurantName: "A Different Name",
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toEqual({ restaurant: false, menu: true });
    expect(body.restaurant).toEqual({ id: existing.id, name: "Existing Café" });
    expect(await listRestaurantsForUser(holder.db!, ownerId)).toHaveLength(1);
  });

  it("publishes the account revision without overwriting it from the local copy", async () => {
    const restaurantId = (await createRestaurant(holder.db!, ownerId, "Account Café")).id;
    await createMenuForUser(holder.db!, ownerId, restaurantId, sampleDoc("Account version"));

    const res = await publishSetup(
      jsonRequest({
        doc: sampleDoc("Stale local version"),
        restaurantId,
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toEqual({ restaurant: false, menu: false });
    const live = await getPublishedMenuByPath(
      holder.db!,
      body.publication.restaurantSlug,
      body.publication.slug
    );
    expect(live?.doc.title).toBe("Account version");
    expect((await getMenuForUser(holder.db!, ownerId, MENU_ID)).doc.title).toBe("Account version");
  });

  it("finishes a partial attempt on retry without duplicating anything", async () => {
    const body = {
      doc: sampleDoc("Retry Lunch"),
      restaurantName: "Retry Café",
      ...PUBLISH_STYLE,
    };

    const first = await publishSetup(jsonRequest(body), menuParams());
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.created).toEqual({ restaurant: true, menu: true });

    const second = await publishSetup(jsonRequest(body), menuParams());
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.created).toEqual({ restaurant: false, menu: false });
    expect(secondBody.publication.urlPath).toBe(firstBody.publication.urlPath);

    expect(await listRestaurantsForUser(holder.db!, ownerId)).toHaveLength(1);
    expect(await listMenusForUser(holder.db!, ownerId)).toHaveLength(1);
  });

  it("asks for a restaurant name when the owner has none", async () => {
    const res = await publishSetup(
      jsonRequest({ doc: sampleDoc("Nameless"), ...PUBLISH_STYLE }),
      menuParams()
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
    expect(await listRestaurantsForUser(holder.db!, ownerId)).toHaveLength(0);
    expect(await listMenusForUser(holder.db!, ownerId)).toHaveLength(0);
  });

  it("asks which restaurant to use when the owner has several", async () => {
    const first = await createRestaurant(holder.db!, ownerId, "One Café");
    await createRestaurant(holder.db!, ownerId, "Two Café");

    const undecided = await publishSetup(
      jsonRequest({ doc: sampleDoc("Lunch"), ...PUBLISH_STYLE }),
      menuParams()
    );
    expect(undecided.status).toBe(400);
    expect(await listMenusForUser(holder.db!, ownerId)).toHaveLength(0);

    const chosen = await publishSetup(
      jsonRequest({
        doc: sampleDoc("Lunch"),
        restaurantId: first.id,
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );
    expect(chosen.status).toBe(200);
    expect((await chosen.json()).restaurant.id).toBe(first.id);
  });

  it("refuses a draft whose id does not match the route", async () => {
    const res = await publishSetup(
      jsonRequest({
        doc: sampleDoc("Wrong id", "another-menu"),
        restaurantName: "Café",
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );

    expect(res.status).toBe(400);
    expect(await listRestaurantsForUser(holder.db!, ownerId)).toHaveLength(0);
  });

  it("refuses staff and other tenants, and writes nothing", async () => {
    const restaurantId = (await createRestaurant(holder.db!, ownerId, "Owner Café")).id;
    await createMenuForUser(holder.db!, ownerId, restaurantId, sampleDoc("Owned menu"));

    const { seedUser } = await import("./helpers/pg-test-db");
    const staffId = await seedUser(holder.db!, "setup-staff@cafe.test", "Staff");
    await holder.db!.insert(restaurantMembership).values({
      restaurantId,
      userId: staffId,
      role: "staff",
    });
    holder.userId = staffId;

    const staffRes = await publishSetup(
      jsonRequest({ doc: sampleDoc("Staff copy"), ...PUBLISH_STYLE }),
      menuParams()
    );
    expect(staffRes.status).toBe(403);

    const outsiderId = await seedUser(holder.db!, "setup-outsider@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsiderId, "Other Café");
    holder.userId = outsiderId;
    const outsiderRes = await publishSetup(
      jsonRequest({ doc: sampleDoc("Outsider copy"), ...PUBLISH_STYLE }),
      menuParams()
    );
    expect(outsiderRes.status).toBe(404);
    expect((await getMenuForUser(holder.db!, ownerId, MENU_ID)).doc.title).toBe("Owned menu");
  });

  it("keeps the draft after an explicit link is taken, and a retry publishes", async () => {
    const restaurantId = (await createRestaurant(holder.db!, ownerId, "Link Café")).id;
    await createMenuForUser(holder.db!, ownerId, restaurantId, sampleDoc("First", "first-menu"));
    await publishMenuForUser(holder.db!, ownerId, "first-menu", {
      ...PUBLISH_STYLE,
      slug: "lunch",
    });

    const taken = await publishSetup(
      jsonRequest({
        doc: sampleDoc("Second"),
        restaurantId,
        slug: "lunch",
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("slug_taken");
    // The account copy exists, so nothing the owner typed was lost.
    expect(await listMenusForUser(holder.db!, ownerId)).toHaveLength(2);

    const retry = await publishSetup(
      jsonRequest({
        doc: sampleDoc("Second"),
        restaurantId,
        ...PUBLISH_STYLE,
      }),
      menuParams()
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).publication.isLive).toBe(true);
  });

  it("requires a session and refuses another site", async () => {
    holder.userId = null;
    const signedOut = await publishSetup(
      jsonRequest({ doc: sampleDoc("No session"), restaurantName: "Café", ...PUBLISH_STYLE }),
      menuParams()
    );
    expect(signedOut.status).toBe(401);

    holder.userId = ownerId;
    const crossOrigin = await publishSetup(
      jsonRequest(
        { doc: sampleDoc("Cross origin"), restaurantName: "Café", ...PUBLISH_STYLE },
        "http://evil.test"
      ),
      menuParams()
    );
    expect(crossOrigin.status).toBe(403);
    expect(await listRestaurantsForUser(holder.db!, ownerId)).toHaveLength(0);
  });
});
