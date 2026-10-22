import { beforeEach, describe, expect, it } from "vitest";

import { createMenuForUser } from "@/features/menus/repo";
import { publishMenuForUser, unpublishMenuForUser } from "@/features/publishing/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import {
  ensureRestaurantSlugForUser,
  getRestaurantBySlug,
  getRestaurantTimeZoneForMenu,
  listOpenMenusForRestaurantSlug,
  setMenuAvailabilityForUser,
  setRestaurantSlugForUser,
} from "@/features/tables/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * Steps 1–2 — the table landing model. One QR per table resolves to the
 * restaurant; each menu carries opening windows (empty = always open) and
 * the landing lists only live published menus whose windows cover `now`.
 * Runs against the real generated DDL on PGlite, like the other repo tests.
 */

// Monday 2026-10-19 12:00 UTC.
const MON_NOON = new Date("2026-10-19T12:00:00.000Z");

describe("table landing repo", () => {
  let db: TestDb;
  let ownerA: string;
  let staffA: string;
  let ownerB: string;
  let restaurantA: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    ownerA = await seedUser(db, "table-owner-a@cafe.test", "Owner A");
    staffA = await seedUser(db, "table-staff-a@cafe.test", "Staff A");
    ownerB = await seedUser(db, "table-owner-b@cafe.test", "Owner B");
    restaurantA = (await createRestaurant(db, ownerA, "Café A")).id;
    // Staff membership so the forbidden paths have a member to refuse.
    const { addMemberForOwner } = await import("@/features/tenancy/repo");
    // addMemberForOwner needs the staff account to exist (seeded above).
    await addMemberForOwner(db, ownerA, restaurantA, "table-staff-a@cafe.test", "staff");
  }, 30_000);

  function sampleDoc(id: string, title = "House Menu"): MenuDocument {
    return menuDocumentSchema.parse({ ...createSampleMenuDocument(), id, title });
  }

  async function publishOpenMenu(menuId: string, title = "House Menu") {
    await createMenuForUser(db, ownerA, restaurantA, sampleDoc(menuId, title));
    await publishMenuForUser(db, ownerA, menuId, { theme: "bistro", layout: "list" });
  }

  describe("menu availability writes", () => {
    it("stores windows with the restaurant's zone, and only replaces the zone when told", async () => {
      await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-avail-1"));
      const stored = await setMenuAvailabilityForUser(
        db,
        ownerA,
        "menu-avail-1",
        [{ days: [1, 2, 3, 4, 5], start: "11:00", end: "15:00" }],
        "Australia/Sydney"
      );
      expect(stored).toEqual({
        availability: [{ days: [1, 2, 3, 4, 5], start: "11:00", end: "15:00" }],
        timeZone: "Australia/Sydney",
      });
      expect(await getRestaurantTimeZoneForMenu(db, "menu-avail-1")).toBe("Australia/Sydney");

      // Omitting the zone leaves the stored one alone; null clears it (UTC).
      const kept = await setMenuAvailabilityForUser(db, ownerA, "menu-avail-1", []);
      expect(kept.timeZone).toBe("Australia/Sydney");
      const cleared = await setMenuAvailabilityForUser(db, ownerA, "menu-avail-1", [], null);
      expect(cleared.timeZone).toBeNull();
    });

    it("rejects a time zone the runtime does not recognise", async () => {
      await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-avail-4"));
      await expect(
        setMenuAvailabilityForUser(db, ownerA, "menu-avail-4", [], "Mars/Olympus")
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("rejects invalid windows without touching the row", async () => {
      await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-avail-2"));
      await expect(
        setMenuAvailabilityForUser(db, ownerA, "menu-avail-2", [
          { days: [1], start: "09:00", end: "09:00" },
        ])
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("refuses staff writes and other tenants' menus", async () => {
      await createMenuForUser(db, ownerA, restaurantA, sampleDoc("menu-avail-3"));
      await expect(
        setMenuAvailabilityForUser(db, staffA, "menu-avail-3", [])
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        setMenuAvailabilityForUser(db, ownerB, "menu-avail-3", [])
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("restaurant slugs", () => {
    it("sets, reads back, and resolves a public slug", async () => {
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      expect(await getRestaurantBySlug(db, "cafe-a")).toMatchObject({ id: restaurantA });
    });

    it("returns null for unknown or malformed slugs", async () => {
      expect(await getRestaurantBySlug(db, "no-such-cafe")).toBeNull();
      expect(await getRestaurantBySlug(db, "Not A Slug!")).toBeNull();
    });

    it("rejects invalid slugs and duplicates across tenants", async () => {
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      await expect(
        setRestaurantSlugForUser(db, ownerA, restaurantA, "Bad Slug!")
      ).rejects.toMatchObject({ code: "invalid" });
      const restaurantB = (await createRestaurant(db, ownerB, "Café B")).id;
      await expect(
        setRestaurantSlugForUser(db, ownerB, restaurantB, "cafe-a")
      ).rejects.toMatchObject({ code: "slug_taken" });
    });

    it("refuses staff slug writes and other tenants", async () => {
      await expect(
        setRestaurantSlugForUser(db, staffA, restaurantA, "cafe-a")
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        setRestaurantSlugForUser(db, ownerB, restaurantA, "cafe-a")
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("derives a slug from the restaurant name when none is set", async () => {
      const ensured = await ensureRestaurantSlugForUser(db, ownerA, restaurantA);
      expect(ensured.slug).toBe("cafe-a");
      // Second call keeps the existing slug instead of re-deriving.
      expect((await ensureRestaurantSlugForUser(db, ownerA, restaurantA)).slug).toBe(
        ensured.slug
      );
    });
  });

  describe("open-menu listing", () => {
    it("returns null for an unknown restaurant slug", async () => {
      expect(await listOpenMenusForRestaurantSlug(db, "no-such-cafe", MON_NOON)).toBeNull();
    });

    it("lists an unrestricted live menu and reports the restaurant", async () => {
      await publishOpenMenu("menu-open-1", "Lunch");
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      const landing = await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON);
      expect(landing?.restaurantName).toBe("Café A");
      expect(landing?.menus.map((m) => m.menuId)).toEqual(["menu-open-1"]);
      expect(landing?.menus[0]).toMatchObject({
        menuSlug: expect.any(String),
        title: "Lunch",
        theme: "bistro",
        layout: "list",
      });
    });

    it("reports a live menu outside its hours as closed instead of hiding it", async () => {
      await publishOpenMenu("menu-closed-1", "Sunday Roast");
      await setMenuAvailabilityForUser(db, ownerA, "menu-closed-1", [
        { days: [0], start: "11:00", end: "15:00" },
      ]);
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      const landing = await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON);
      expect(landing?.menus).toEqual([]);
      expect(landing?.closedMenus).toEqual([
        {
          menuId: "menu-closed-1",
          title: "Sunday Roast",
          availability: [{ days: [0], start: "11:00", end: "15:00" }],
        },
      ]);
    });

    it("splits one landing into open and closed menus", async () => {
      await publishOpenMenu("menu-mixed-open", "Lunch");
      await publishOpenMenu("menu-mixed-closed", "Sunday Roast");
      await setMenuAvailabilityForUser(db, ownerA, "menu-mixed-closed", [
        { days: [0], start: "11:00", end: "15:00" },
      ]);
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      const landing = await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON);
      expect(landing?.menus.map((m) => m.menuId)).toEqual(["menu-mixed-open"]);
      expect(landing?.closedMenus.map((m) => m.menuId)).toEqual(["menu-mixed-closed"]);
    });

    it("never lists an unrestricted menu as closed, or an unpublished one at all", async () => {
      await publishOpenMenu("menu-free-1", "All day");
      await publishOpenMenu("menu-unpub-2", "Brunch");
      await setMenuAvailabilityForUser(db, ownerA, "menu-unpub-2", [
        { days: [0], start: "11:00", end: "15:00" },
      ]);
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      let landing = await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON);
      // Unrestricted = open; the Sunday-only one is closed, not missing.
      expect(landing?.menus.map((m) => m.menuId)).toEqual(["menu-free-1"]);
      expect(landing?.closedMenus.map((m) => m.menuId)).toEqual(["menu-unpub-2"]);
      // Unpublishing removes it from both lists.
      await unpublishMenuForUser(db, ownerA, "menu-unpub-2");
      landing = await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON);
      expect(landing?.closedMenus).toEqual([]);
    });

    it("judges the windows in the restaurant's zone, not UTC", async () => {
      await publishOpenMenu("menu-zone-1", "To Go Menu");
      await setMenuAvailabilityForUser(
        db,
        ownerA,
        "menu-zone-1",
        [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }],
        "Australia/Sydney"
      );
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      // Thursday 2026-10-22 10:41 UTC is 21:41 Thursday in Sydney: past 5pm,
      // so the menu must not be listed even though 10:41 UTC is inside 9–5.
      const evening = await listOpenMenusForRestaurantSlug(
        db,
        "cafe-a",
        new Date("2026-10-22T10:41:00.000Z")
      );
      expect(evening?.menus).toEqual([]);
      // The same windows are wide open at Sydney lunchtime (02:00 UTC = 13:00).
      const lunchtime = await listOpenMenusForRestaurantSlug(
        db,
        "cafe-a",
        new Date("2026-10-22T02:00:00.000Z")
      );
      expect(lunchtime?.menus.map((m) => m.menuId)).toEqual(["menu-zone-1"]);
    });

    it("stops listing a menu after it is unpublished", async () => {
      await publishOpenMenu("menu-unpub-1", "Lunch");
      await setRestaurantSlugForUser(db, ownerA, restaurantA, "cafe-a");
      expect(
        (await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON))?.menus
      ).toHaveLength(1);
      await unpublishMenuForUser(db, ownerA, "menu-unpub-1");
      expect(
        (await listOpenMenusForRestaurantSlug(db, "cafe-a", MON_NOON))?.menus
      ).toEqual([]);
    });
  });
});
