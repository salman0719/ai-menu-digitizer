import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as getAvailability,
  PUT as putAvailability,
} from "@/app/api/menus/[menuId]/availability/route";
import {
  GET as getSlug,
  PUT as putSlug,
} from "@/app/api/restaurants/[restaurantId]/slug/route";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { restaurantMembership } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for Step 4a (PGlite + real handlers, only the session
 * lookup stubbed). Availability reads are member-scoped, writes owner-only;
 * the restaurant link is claimed explicitly or derived, with cross-tenant
 * slugs colliding into 409 rather than leaking.
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

function jsonRequest(body: unknown): Request {
  return new Request("http://test.local/api", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function menuParams(menuId: string): { params: Promise<{ menuId: string }> } {
  return { params: Promise.resolve({ menuId }) };
}

function restaurantParams(restaurantId: string): { params: Promise<{ restaurantId: string }> } {
  return { params: Promise.resolve({ restaurantId }) };
}

let ownerId: string;
let staffId: string;
let restaurantId: string;
const menuId = "menu-avail-api";

function sampleDoc(): MenuDocument {
  return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id: menuId });
}

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "avail-api-owner@cafe.test", "Owner");
  staffId = await seedUser(holder.db, "avail-api-staff@cafe.test", "Staff");
  restaurantId = (await createRestaurant(holder.db, ownerId, "Café Avail")).id;
  await holder.db.insert(restaurantMembership).values({ restaurantId, userId: staffId, role: "staff" });
  await createMenuForUser(holder.db, ownerId, restaurantId, sampleDoc());
  holder.userId = ownerId;
}, 30_000);

describe("GET /api/menus/[menuId]/availability", () => {
  it("requires a session", async () => {
    holder.userId = null;
    const res = await getAvailability(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(401);
  });

  it("returns the empty schedule by default", async () => {
    const res = await getAvailability(new Request("http://test.local"), menuParams(menuId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ availability: [], timeZone: null });
  });

  it("lets staff read but hides other tenants behind 404", async () => {
    holder.userId = staffId;
    expect((await getAvailability(new Request("http://test.local"), menuParams(menuId))).status).toBe(200);

    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "avail-outsider@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café");
    holder.userId = outsider;
    expect((await getAvailability(new Request("http://test.local"), menuParams(menuId))).status).toBe(404);
  });
});

describe("PUT /api/menus/[menuId]/availability", () => {
  const lunch = [{ days: [1, 2, 3, 4, 5], start: "11:00", end: "15:00" }];

  it("stores windows for the owner and reads them back", async () => {
    const res = await putAvailability(jsonRequest({ windows: lunch }), menuParams(menuId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ availability: lunch, timeZone: null });

    const read = await getAvailability(new Request("http://test.local"), menuParams(menuId));
    expect(await read.json()).toEqual({ availability: lunch, timeZone: null });
  });

  it("stores the restaurant's time zone, keeps it when omitted, rejects nonsense", async () => {
    const withZone = await putAvailability(
      jsonRequest({ windows: lunch, timeZone: "Australia/Sydney" }),
      menuParams(menuId)
    );
    expect(withZone.status).toBe(200);
    expect(await withZone.json()).toEqual({ availability: lunch, timeZone: "Australia/Sydney" });

    // Omitting the zone must not reset it to UTC.
    const kept = await putAvailability(jsonRequest({ windows: lunch }), menuParams(menuId));
    expect(await kept.json()).toEqual({ availability: lunch, timeZone: "Australia/Sydney" });

    // An unrecognised zone is refused and changes nothing.
    const bad = await putAvailability(
      jsonRequest({ windows: lunch, timeZone: "Mars/Olympus" }),
      menuParams(menuId)
    );
    expect(bad.status).toBe(400);
    const read = await getAvailability(new Request("http://test.local"), menuParams(menuId));
    expect(await read.json()).toEqual({ availability: lunch, timeZone: "Australia/Sydney" });

    // An explicit null clears it back to the UTC fallback.
    const cleared = await putAvailability(
      jsonRequest({ windows: lunch, timeZone: null }),
      menuParams(menuId)
    );
    expect(await cleared.json()).toEqual({ availability: lunch, timeZone: null });
  });

  it("rejects invalid windows without storing anything", async () => {
    const res = await putAvailability(
      jsonRequest({ windows: [{ days: [1], start: "09:00", end: "09:00" }] }),
      menuParams(menuId)
    );
    expect(res.status).toBe(400);

    const read = await getAvailability(new Request("http://test.local"), menuParams(menuId));
    expect(await read.json()).toEqual({ availability: [], timeZone: null });
  });

  it("refuses staff writes and other tenants", async () => {
    holder.userId = staffId;
    expect((await putAvailability(jsonRequest({ windows: lunch }), menuParams(menuId))).status).toBe(403);

    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "avail-outsider-2@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café 2");
    holder.userId = outsider;
    expect((await putAvailability(jsonRequest({ windows: lunch }), menuParams(menuId))).status).toBe(404);
  });
});

describe("GET /api/restaurants/[restaurantId]/slug", () => {
  it("requires a session", async () => {
    holder.userId = null;
    const res = await getSlug(new Request("http://test.local"), restaurantParams(restaurantId));
    expect(res.status).toBe(401);
  });

  it("reports a null slug until claimed", async () => {
    const res = await getSlug(new Request("http://test.local"), restaurantParams(restaurantId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      restaurant: { id: restaurantId, name: "Café Avail", slug: null },
    });
  });

  it("hides other tenants behind 404", async () => {
    const { seedUser } = await import("./helpers/pg-test-db");
    const outsider = await seedUser(holder.db!, "avail-outsider-3@cafe.test", "Outsider");
    await createRestaurant(holder.db!, outsider, "Other Café 3");
    holder.userId = outsider;
    expect((await getSlug(new Request("http://test.local"), restaurantParams(restaurantId))).status).toBe(404);
  });
});

describe("PUT /api/restaurants/[restaurantId]/slug", () => {
  it("claims the derived address with ensure", async () => {
    const res = await putSlug(jsonRequest({ ensure: true }), restaurantParams(restaurantId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      restaurant: { id: restaurantId, name: "Café Avail", slug: "cafe-avail" },
    });
  });

  it("sets an explicit address", async () => {
    const res = await putSlug(jsonRequest({ slug: "my-cafe" }), restaurantParams(restaurantId));
    expect(res.status).toBe(200);
    expect((await res.json()).restaurant.slug).toBe("my-cafe");
  });

  it("rejects invalid addresses and taken ones", async () => {
    expect(
      (await putSlug(jsonRequest({ slug: "Bad Slug!" }), restaurantParams(restaurantId))).status
    ).toBe(400);

    const { seedUser } = await import("./helpers/pg-test-db");
    const other = await seedUser(holder.db!, "avail-other@cafe.test", "Other");
    const otherRestaurant = (await createRestaurant(holder.db!, other, "Other")).id;
    await putSlug(jsonRequest({ slug: "taken-link" }), restaurantParams(restaurantId));
    holder.userId = other;
    const taken = await putSlug(
      jsonRequest({ slug: "taken-link" }),
      restaurantParams(otherRestaurant)
    );
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("slug_taken");
  });

  it("refuses staff writes", async () => {
    holder.userId = staffId;
    expect(
      (await putSlug(jsonRequest({ ensure: true }), restaurantParams(restaurantId))).status
    ).toBe(403);
  });
});
