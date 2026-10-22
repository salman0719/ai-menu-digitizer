import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { publishMenuForUser, unpublishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { proxy } from "@/proxy";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * The address move (Step 9 follow-up): menu pages moved from the global
 * `/m/<slug>` namespace to `/r/<restaurant>/m/<menu>`, and the proxy keeps
 * every old link working. These tests pin the behaviour a printed QR code
 * depends on:
 *
 * - a live legacy link answers with a real 308 to the canonical address,
 *   query string intact, so old table cards keep opening;
 * - the old view beacon moves the same way, so stale pages keep counting;
 * - an unknown, unpublished, or renamed-away slug is left alone — it must
 *   reach the route and 404, never redirect somewhere plausible;
 * - canonical addresses are never touched.
 */

const holder: { db: TestDb | null } = { db: null };

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

const menuId = "menu-legacy-1";
let ownerId: string;

beforeEach(async () => {
  holder.db = await initTestDb();
  const { seedUser } = await import("./helpers/pg-test-db");
  ownerId = await seedUser(holder.db, "legacy-owner@cafe.test", "Owner");
  const restaurantId = (await createRestaurant(holder.db, ownerId, "Café Legacy")).id;
  await createMenuForUser(
    holder.db,
    ownerId,
    restaurantId,
    menuDocumentSchema.parse({
      ...createSampleMenuDocument(),
      id: menuId,
      title: "Café Legacy — Menu",
    })
  );
  await publishMenuForUser(holder.db, ownerId, menuId, { theme: "bistro", layout: "columns" });
}, 30_000);

async function pass(url: string): Promise<Response> {
  return proxy(new NextRequest(url));
}

describe("legacy /m/<slug> redirects", () => {
  it("sends a live legacy link to the canonical address with a 308", async () => {
    const response = await pass("http://test.local/m/cafe-legacy-menu");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://test.local/r/cafe-legacy/m/cafe-legacy-menu"
    );
    // The request id keeps flowing through a redirect.
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("keeps the rest of the path and the query string", async () => {
    const response = await pass("http://test.local/m/cafe-legacy-menu/order?table=Patio%202");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://test.local/r/cafe-legacy/m/cafe-legacy-menu/order?table=Patio%202"
    );
  });

  it("moves the old view beacon with the page", async () => {
    const response = await pass("http://test.local/api/m/cafe-legacy-menu/view");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://test.local/api/r/cafe-legacy/m/cafe-legacy-menu/view"
    );
  });

  it("leaves unknown, unpublished, and non-slug paths alone", async () => {
    const unknown = await pass("http://test.local/m/never-published");
    expect(unknown.headers.get("location")).toBeNull();

    // Unpublishing stops the redirect, exactly as it stops the page.
    await unpublishMenuForUser(holder.db!, ownerId, menuId);
    const unpublished = await pass("http://test.local/m/cafe-legacy-menu");
    expect(unpublished.headers.get("location")).toBeNull();

    // A path that cannot name a slug is not a candidate either.
    const notASlug = await pass("http://test.local/m/Not%20A%20Slug");
    expect(notASlug.headers.get("location")).toBeNull();
  });

  it("never touches canonical addresses", async () => {
    const response = await pass("http://test.local/r/cafe-legacy/m/cafe-legacy-menu");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
