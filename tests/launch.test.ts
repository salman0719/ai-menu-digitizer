import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema } from "@/features/menu/schema";
import { createMenuForUser } from "@/features/menus/repo";
import { getLaunchSnapshot } from "@/features/launch/repo";
import type { LaunchSnapshot } from "@/features/launch/schema";
import { launchSteps, verifiedProgress } from "@/features/launch/steps";
import { placeOrderFromSlug } from "@/features/orders/repo";
import { publishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import type { TestDb } from "./helpers/pg-test-db";

const holder: { db: TestDb | null; userId: string | null } = { db: null, userId: null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

const emptySnapshot: LaunchSnapshot = {
  menuCount: 0,
  publishedCount: 0,
  liveSlug: null,
  orderCount: 0,
  unpricedItems: 0,
  reviewNotes: 0,
  unreadableMenus: 0,
};

describe("launch steps", () => {
  it("marks nothing done for a brand-new account and counts only verifiable steps", () => {
    const steps = launchSteps(emptySnapshot);
    expect(steps.map((step) => step.id)).toEqual([
      "extract",
      "review",
      "theme",
      "cards",
      "publish",
      "order",
    ]);
    expect(steps.filter((step) => step.done)).toHaveLength(0);
    expect(steps.find((step) => step.id === "cards")?.manual).toBe(true);
    expect(verifiedProgress(steps)).toEqual({ done: 0, total: 5 });
  });

  it("keeps review open while any item is unpriced or noted", () => {
    const steps = launchSteps({
      ...emptySnapshot,
      menuCount: 1,
      unpricedItems: 2,
      reviewNotes: 1,
    });
    const review = steps.find((step) => step.id === "review");
    expect(review?.done).toBe(false);
    expect(review?.detail).toBe("3 items still need a look");
    expect(steps.find((step) => step.id === "extract")?.done).toBe(true);
  });

  it("reports a live address and the first order once they exist", () => {
    const steps = launchSteps({
      ...emptySnapshot,
      menuCount: 2,
      publishedCount: 1,
      liveSlug: "cafe-a",
      orderCount: 3,
    });
    expect(steps.find((step) => step.id === "publish")).toMatchObject({
      done: true,
      detail: "Live at /m/cafe-a",
    });
    expect(steps.find((step) => step.id === "order")).toMatchObject({
      done: true,
      detail: "3 orders received",
    });
    expect(steps.find((step) => step.id === "theme")?.done).toBe(true);
    // Printing is still the owner's word, not our inference.
    expect(steps.find((step) => step.id === "cards")?.done).toBe(false);
  });

  it("does not let unreadable menus hide behind a clean count", () => {
    const steps = launchSteps({ ...emptySnapshot, menuCount: 1, unreadableMenus: 1 });
    expect(steps.find((step) => step.id === "extract")?.done).toBe(true);
  });
});

describe("launch snapshot", () => {
  let db: TestDb;
  let ownerId: string;
  let otherId: string;
  let restaurantId: string;

  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    ({ db } = await createTestDb());
    ownerId = await seedUser(db, "launch-owner@cafe.test", "Owner");
    otherId = await seedUser(db, "launch-other@cafe.test", "Other");
    restaurantId = (await createRestaurant(db, ownerId, "Launch Café")).id;
  }, 30_000);

  it("reports an empty account as empty", async () => {
    await expect(getLaunchSnapshot(db, ownerId)).resolves.toEqual(emptySnapshot);
  });

  it("counts menus, review flags, the live slug, and orders — for the right tenant only", async () => {
    const doc = menuDocumentSchema.parse({
      ...createSampleMenuDocument(),
      id: "menu-launch-a",
      title: "Launch Café Menu",
    });
    await createMenuForUser(db, ownerId, restaurantId, doc);
    const publication = await publishMenuForUser(db, ownerId, "menu-launch-a", {
      theme: "classic",
      layout: "list",
    });

    await placeOrderFromSlug(db, {
      slug: publication.slug,
      tableLabel: "2",
      note: null,
      lines: [
        { menuItemId: doc.categories[0].items[0].id, variantName: "Double", quantity: 1 },
      ],
    });

    const snapshot = await getLaunchSnapshot(db, ownerId);
    expect(snapshot).toMatchObject({
      menuCount: 1,
      publishedCount: 1,
      liveSlug: publication.slug,
      orderCount: 1,
      unpricedItems: 1,
      reviewNotes: 2,
      unreadableMenus: 0,
    });

    // The other account sees none of it.
    await expect(getLaunchSnapshot(db, otherId)).resolves.toEqual(emptySnapshot);
  });
});

describe("GET /api/launch", () => {
  beforeEach(async () => {
    const { createTestDb, seedUser } = await import("./helpers/pg-test-db");
    const { db } = await createTestDb();
    holder.db = db;
    holder.userId = await seedUser(db, "launch-api@cafe.test", "API Owner");
    await createRestaurant(db, holder.userId, "API Café");
  }, 30_000);

  it("returns the checklist state plus this month's usage", async () => {
    const { GET } = await import("@/app/api/launch/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      launch: LaunchSnapshot & {
        usage: { requests: number; cap: number; remaining: number } | null;
      };
    };
    expect(body.launch).toMatchObject({ menuCount: 0, publishedCount: 0, orderCount: 0 });
    expect(body.launch.usage).toMatchObject({ requests: 0, remaining: body.launch.usage?.cap });
  });

  it("answers 401 when signed out", async () => {
    holder.userId = null;
    const { GET } = await import("@/app/api/launch/route");
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
