import { beforeEach, describe, expect, it } from "vitest";

import {
  getOrderAlertPrefs,
  listOwnerEmails,
  recordOrderEmailAttempt,
  updateOrderAlertPrefsForOwner,
  wasOrderEmailed,
} from "@/features/orders/alerts";
import { addMemberForOwner } from "@/features/tenancy/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { createTestDb, seedUser, type TestDb } from "./helpers/pg-test-db";

/**
 * R0.4 — new-order email alerts: per-restaurant preference (default on,
 * owner-only writes), owner emails as default recipients, and the send
 * gate (one email per order, digest guard for rushes).
 */
describe("order alerts", () => {
  let db: TestDb;
  let owner: string;
  let staff: string;
  let outsider: string;
  let restaurantId: string;

  beforeEach(async () => {
    ({ db } = await createTestDb());
    owner = await seedUser(db, "alerts-owner@cafe.test", "Owner");
    staff = await seedUser(db, "alerts-staff@cafe.test", "Staff");
    outsider = await seedUser(db, "alerts-out@cafe.test", "Outsider");
    restaurantId = (await createRestaurant(db, owner, "Café Alerts")).id;
    await addMemberForOwner(db, owner, restaurantId, "alerts-staff@cafe.test", "staff");
  }, 30_000);

  it("defaults to enabled with the owners' emails", async () => {
    const prefs = await getOrderAlertPrefs(db, owner, restaurantId);
    expect(prefs).toMatchObject({ enabled: true, email: null, role: "owner" });
    expect(await listOwnerEmails(db, restaurantId)).toEqual(["alerts-owner@cafe.test"]);
  });

  it("is invisible across tenants and writable only by owners", async () => {
    expect(await getOrderAlertPrefs(db, outsider, restaurantId)).toBeNull();
    expect(
      await updateOrderAlertPrefsForOwner(db, staff, restaurantId, {
        enabled: false,
        email: null,
      })
    ).toBeNull();
    expect(
      await updateOrderAlertPrefsForOwner(db, outsider, restaurantId, {
        enabled: false,
        email: null,
      })
    ).toBeNull();
    const updated = await updateOrderAlertPrefsForOwner(db, owner, restaurantId, {
      enabled: false,
      email: "till@cafe.test",
    });
    expect(updated).toMatchObject({ enabled: false, email: "till@cafe.test" });
  });

  it("mails once per order, then calls it a duplicate", async () => {
    expect(await recordOrderEmailAttempt(db, restaurantId, "order-1", "till@cafe.test")).toEqual({
      mailed: true,
    });
    expect(await wasOrderEmailed(db, "order-1")).toBe(true);
    expect(await recordOrderEmailAttempt(db, restaurantId, "order-1", "till@cafe.test")).toEqual({
      mailed: false,
      reason: "duplicate",
    });
  });

  it("skips the mail past the digest threshold inside the window", async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        await recordOrderEmailAttempt(db, restaurantId, `rush-${i}`, "till@cafe.test")
      ).toEqual({ mailed: true });
    }
    expect(await recordOrderEmailAttempt(db, restaurantId, "rush-5", "till@cafe.test")).toEqual({
      mailed: false,
      reason: "digest",
    });
    // A new window lets mail through again.
    const later = new Date(Date.now() + 11 * 60_000);
    expect(
      await recordOrderEmailAttempt(db, restaurantId, "rush-6", "till@cafe.test", later)
    ).toEqual({ mailed: true });
  });
});
