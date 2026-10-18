import { beforeEach, describe, expect, it } from "vitest";

import { createRestaurant } from "@/features/tenancy/repo";
import {
  createMenuForUser,
  deleteMenuForUser,
  getMenuForUser,
  listMenusForUser,
  MenuRepoError,
  updateMenuForUser,
} from "@/features/menus/repo";
import { restaurantMembership } from "@/lib/db/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Step 8 — server-backed menus. These run against the real generated DDL on
 * PGlite, so they cover the same SQL Neon executes. The two acceptance
 * properties under test: (1) two editing browsers converge through the
 * updatedAt conflict check instead of silently overwriting each other, and
 * (2) importing a local menu preserves ids, order, variants, and review
 * notes exactly.
 */
describe("menu repo", () => {
  let db: TestDb;
  let ownerA: string;
  let ownerB: string;
  let restaurantA: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "menu-owner-a@cafe.test", "Owner A");
    ownerB = await seedUser(db, "menu-owner-b@cafe.test", "Owner B");
    restaurantA = (await createRestaurant(db, ownerA, "Café A")).id;
  }, 30_000);

  function sampleDoc(id: string): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id });
  }

  it("creates, lists, and reads back a menu with the document intact", async () => {
    const doc = sampleDoc("menu-import-1");
    const created = await createMenuForUser(db, ownerA, restaurantA, doc);

    // Ids are preserved — that is what makes account import non-destructive.
    expect(created.id).toBe("menu-import-1");
    expect(created.restaurantId).toBe(restaurantA);
    expect(created.title).toBe(doc.title);

    const fetched = await getMenuForUser(db, ownerA, "menu-import-1");
    // Full fidelity: category/item order, inner ids, variants, options,
    // dietary labels, review notes, honest nulls.
    expect(fetched.doc.categories.map((c) => c.id)).toEqual(doc.categories.map((c) => c.id));
    expect(fetched.doc).toMatchObject({
      schemaVersion: doc.schemaVersion,
      id: doc.id,
      title: doc.title,
      currency: doc.currency,
      categories: doc.categories,
      source: doc.source,
    });
    // The server stamps updatedAt from its own clock.
    expect(fetched.doc.updatedAt).toBe(created.updatedAt);

    const list = await listMenusForUser(db, ownerA);
    expect(list.map((m) => m.id)).toEqual(["menu-import-1"]);
  });

  it("refuses to create over an existing id (import skips existing)", async () => {
    const doc = sampleDoc("menu-dup");
    await createMenuForUser(db, ownerA, restaurantA, doc);
    await expect(createMenuForUser(db, ownerA, restaurantA, doc)).rejects.toMatchObject({
      code: "exists",
    });
  });

  it("keeps one tenant's menus invisible and untouchable to another", async () => {
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-private"));
    await createRestaurant(db, ownerB, "Café B");

    // B sees only their (empty) library…
    expect(await listMenusForUser(db, ownerB)).toEqual([]);
    // …and cannot read, update, or delete A's menu by id.
    await expect(getMenuForUser(db, ownerB, "menu-private")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      updateMenuForUser(db, ownerB, "menu-private", sampleDoc("menu-private"), new Date().toISOString())
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await deleteMenuForUser(db, ownerB, "menu-private")).toBe(false);
    // And cannot create into a restaurant they don't own.
    await expect(
      createMenuForUser(db, ownerB, restaurantA, sampleDoc("menu-intrude"))
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lets staff read but never write menus", async () => {
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-staff-read"));
    const staff = await seedUser(db, "staff@cafe.test", "Staff");
    // Staff membership granted by the owner, as in the tenancy tests.
    await db.insert(restaurantMembership).values({
      restaurantId: restaurantA,
      userId: staff,
      role: "staff",
    });

    // Read works.
    const seen = await getMenuForUser(db, staff, "menu-staff-read");
    expect(seen.id).toBe("menu-staff-read");
    // Writes do not.
    await expect(
      updateMenuForUser(db, staff, "menu-staff-read", sampleDoc("menu-staff-read"), seen.updatedAt)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createMenuForUser(db, staff, restaurantA, sampleDoc("menu-staff-create"))
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteMenuForUser(db, staff, "menu-staff-read")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("rejects a stale expectedUpdatedAt instead of overwriting", async () => {
    const doc = sampleDoc("menu-conflict");
    const created = await createMenuForUser(db, ownerA, restaurantA, doc);

    // Browser 1 saves with the correct token… (a short pause guarantees the
    // server stamps a later millisecond, as it would in real use)
    await new Promise((resolve) => setTimeout(resolve, 5));
    const edit1 = { ...created.doc, title: "Browser 1 title" };
    const saved1 = await updateMenuForUser(db, ownerA, "menu-conflict", edit1, created.updatedAt);
    expect(saved1.title).toBe("Browser 1 title");
    expect(saved1.updatedAt > created.updatedAt).toBe(true);

    // …browser 2 still holds the original token: refused, with the current
    // server updatedAt so the client can offer an explicit reload.
    const edit2 = { ...created.doc, title: "Browser 2 title" };
    let stale: MenuRepoError | null = null;
    try {
      await updateMenuForUser(db, ownerA, "menu-conflict", edit2, created.updatedAt);
    } catch (error) {
      stale = error instanceof MenuRepoError ? error : null;
    }
    expect(stale?.code).toBe("stale");
    expect(stale?.currentUpdatedAt).toBe(saved1.updatedAt);

    // The losing write changed nothing.
    const current = await getMenuForUser(db, ownerA, "menu-conflict");
    expect(current.title).toBe("Browser 1 title");
    expect(current.updatedAt).toBe(saved1.updatedAt);

    // Explicit resync: adopting the server token makes the next save land —
    // two browsers converge predictably.
    const saved2 = await updateMenuForUser(
      db,
      ownerA,
      "menu-conflict",
      { ...current.doc, title: "Browser 2 title, resynced" },
      current.updatedAt
    );
    expect(saved2.title).toBe("Browser 2 title, resynced");
  });

  it("deletes menus, and restaurant deletion cascades to them", async () => {
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-gone"));
    expect(await deleteMenuForUser(db, ownerA, "menu-gone")).toBe(true);
    expect(await deleteMenuForUser(db, ownerA, "menu-gone")).toBe(false);

    // Cascade: removing the restaurant removes its menus (no orphans).
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-orphan-check"));
    const { deleteRestaurantForOwner } = await import("@/features/tenancy/repo");
    await deleteRestaurantForOwner(db, ownerA, restaurantA);
    await expect(getMenuForUser(db, ownerA, "menu-orphan-check")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
