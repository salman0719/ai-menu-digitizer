import { beforeEach, describe, expect, it } from "vitest";

import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import {
  changeMenuSlugForUser,
  getPublishedMenuBySlug,
  getPublicationStatus,
  publishMenuForUser,
  PublicationRepoError,
  recordPublishedView,
  unpublishMenuForUser,
} from "@/features/publishing/repo";
import { createMenuForUser, getMenuForUser, updateMenuForUser } from "@/features/menus/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { menuRevision, publishedMenu, restaurantMembership } from "@/lib/db/schema";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Step 9 — publishing repository, against the real generated DDL on PGlite.
 *
 * The acceptance properties pinned here:
 * - the live page is a snapshot: editing the menu afterwards does not change
 *   what visitors see, and the status honestly reports unpublished changes;
 * - publishing again updates the page and reuses the slug (and view count);
 * - unpublishing stops serving while keeping the slug reserved;
 * - slugs collide safely (suffix on derived names, refusal for a changed one);
 * - tenancy and roles: staff read only, outsiders see nothing and learn nothing.
 */
describe("publishing repo", () => {
  let db: TestDb;
  let ownerA: string;
  let ownerB: string;
  let restaurantA: string;
  let menuId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "pub-owner-a@cafe.test", "Owner A");
    ownerB = await seedUser(db, "pub-owner-b@cafe.test", "Owner B");
    restaurantA = (await createRestaurant(db, ownerA, "Café A")).id;
    menuId = "menu-pub-1";
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(menuId, "Café A — Menu"));
  }, 30_000);

  function sampleDoc(id: string, title: string): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id, title });
  }

  async function publish(slug?: string) {
    return publishMenuForUser(db, ownerA, menuId, {
      theme: "bistro",
      layout: "columns",
      ...(slug ? { slug } : {}),
    });
  }

  it("publishes a snapshot that the public read path serves", async () => {
    const stored = await getMenuForUser(db, ownerA, menuId);
    const status = await publish();
    expect(status.isLive).toBe(true);
    expect(status.slug).toBe("cafe-a-menu");
    expect(status.urlPath).toBe("/m/cafe-a-menu");
    expect(status.theme).toBe("bistro");
    expect(status.layout).toBe("columns");
    expect(status.viewCount).toBe(0);
    expect(status.hasUnpublishedChanges).toBe(false);

    const page = await getPublishedMenuBySlug(db, "cafe-a-menu");
    expect(page).not.toBeNull();
    expect(page!.restaurantName).toBe("Café A");
    expect(page!.theme).toBe("bistro");
    expect(page!.layout).toBe("columns");
    expect(page!.doc.title).toBe("Café A — Menu");
    // Full fidelity: the snapshot is the canonical document, not a summary.
    expect(page!.doc.categories.map((c) => c.id)).toEqual(
      stored.doc.categories.map((c) => c.id)
    );
  });

  it("keeps the public page frozen while the menu keeps being edited", async () => {
    await publish();
    const before = await getPublishedMenuBySlug(db, "cafe-a-menu");

    const current = await getMenuForUser(db, ownerA, menuId);
    const edited = { ...current.doc, title: "Renamed after publishing" };
    await updateMenuForUser(db, ownerA, menuId, edited, current.updatedAt);

    // Visitor view is unchanged…
    const after = await getPublishedMenuBySlug(db, "cafe-a-menu");
    expect(after!.doc.title).toBe(before!.doc.title);
    // …and the owner is told there are unpublished changes.
    const status = await getPublicationStatus(db, ownerA, menuId);
    expect(status!.hasUnpublishedChanges).toBe(true);

    // Publishing changes snapshots the new document and clears the flag.
    const republished = await publish();
    expect(republished.hasUnpublishedChanges).toBe(false);
    expect(republished.slug).toBe("cafe-a-menu");
    expect(republished.viewCount).toBe(0);
    expect((await getPublishedMenuBySlug(db, "cafe-a-menu"))!.doc.title).toBe(
      "Renamed after publishing"
    );

    // History is append-only: two revisions for one menu.
    const revisions = await db.select({ id: menuRevision.id }).from(menuRevision);
    expect(revisions).toHaveLength(2);
  });

  it("suffixes a derived slug on collision instead of failing", async () => {
    await publish();
    const secondId = "menu-pub-2";
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(secondId, "Café A — Menu"));
    const second = await publishMenuForUser(db, ownerA, secondId, {
      theme: "classic",
      layout: "list",
    });
    expect(second.slug).toBe("cafe-a-menu-2");
    expect(second.urlPath).toBe("/m/cafe-a-menu-2");
  });

  it("refuses a slug the owner explicitly asked for when it is taken", async () => {
    await publish("taken-link");
    const secondId = "menu-pub-3";
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(secondId, "Other"));
    await expect(
      publishMenuForUser(db, ownerA, secondId, {
        theme: "classic",
        layout: "list",
        slug: "taken-link",
      })
    ).rejects.toMatchObject({ code: "slug_taken" });
  });

  it("changes the address without losing the publication", async () => {
    await publish();
    const changed = await changeMenuSlugForUser(db, ownerA, menuId, "chez-a");
    expect(changed.slug).toBe("chez-a");
    expect(changed.urlPath).toBe("/m/chez-a");
    expect(changed.isLive).toBe(true);
    expect(await getPublishedMenuBySlug(db, "cafe-a-menu")).toBeNull();
    expect(await getPublishedMenuBySlug(db, "chez-a")).not.toBeNull();

    await expect(changeMenuSlugForUser(db, ownerA, menuId, "Two Words")).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("unpublishes without releasing the slug, and reuses it on republish", async () => {
    await publish();
    await recordPublishedView(db, "cafe-a-menu");
    await recordPublishedView(db, "cafe-a-menu");

    const unpublished = await unpublishMenuForUser(db, ownerA, menuId);
    expect(unpublished.isLive).toBe(false);
    expect(unpublished.publishedAt).toBeNull();
    expect(unpublished.liveRevisionId).toBeNull();
    expect(unpublished.slug).toBe("cafe-a-menu");
    expect(unpublished.viewCount).toBe(2);
    // The address is reserved but stops serving.
    expect(await getPublishedMenuBySlug(db, "cafe-a-menu")).toBeNull();
    expect(await recordPublishedView(db, "cafe-a-menu")).toBe(false);

    const republished = await publish();
    expect(republished.isLive).toBe(true);
    expect(republished.slug).toBe("cafe-a-menu");
    expect(republished.viewCount).toBe(2);
  });

  it("counts views atomically and only while live", async () => {
    expect(await recordPublishedView(db, "never-published")).toBe(false);
    await publish();
    expect(await recordPublishedView(db, "cafe-a-menu")).toBe(true);
    expect(await recordPublishedView(db, "cafe-a-menu")).toBe(true);
    expect((await getPublicationStatus(db, ownerA, menuId))!.viewCount).toBe(2);
  });

  it("keeps other tenants out and lets staff read but never publish", async () => {
    await publish();
    await createRestaurant(db, ownerB, "Café B");

    await expect(getPublicationStatus(db, ownerB, menuId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      publishMenuForUser(db, ownerB, menuId, { theme: "classic", layout: "list" })
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(unpublishMenuForUser(db, ownerB, menuId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(changeMenuSlugForUser(db, ownerB, menuId, "stolen")).rejects.toMatchObject({
      code: "not_found",
    });

    const staffId = await seedUser(db, "staff@cafe.test", "Staff");
    await db.insert(restaurantMembership).values({ restaurantId: restaurantA, userId: staffId, role: "staff" });
    // Staff may see the status…
    expect((await getPublicationStatus(db, staffId, menuId))!.isLive).toBe(true);
    // …but never publish, change the link, or unpublish.
    await expect(
      publishMenuForUser(db, staffId, menuId, { theme: "classic", layout: "list" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(changeMenuSlugForUser(db, staffId, menuId, "staff-link")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(unpublishMenuForUser(db, staffId, menuId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("reports a menu that was never published as null, not an error", async () => {
    expect(await getPublicationStatus(db, ownerA, menuId)).toBeNull();
    expect(await db.select({ id: publishedMenu.id }).from(publishedMenu)).toHaveLength(0);
  });

  it("rejects publishing an invalid document rather than storing garbage", async () => {
    // Corrupt the stored doc the way a bad migration would.
    await db.execute("update menu set doc = '{\"nope\":true}'::jsonb");
    await expect(publish()).rejects.toBeInstanceOf(PublicationRepoError);
    expect(await db.select({ id: publishedMenu.id }).from(publishedMenu)).toHaveLength(0);
  });
});
