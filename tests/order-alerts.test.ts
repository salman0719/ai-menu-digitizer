import { beforeEach, describe, expect, it } from "vitest";

import {
  getOrderAlertPrefs,
  listOwnerEmails,
  recordOrderEmailAttempt,
  updateOrderAlertPrefsForOwner,
  wasOrderEmailed,
} from "@/features/orders/alerts";
import { buildNewOrderEmail, maybeEmailNewOrder } from "@/features/orders/order-mailer";
import type { NewOrderEmail } from "@/features/orders/order-mailer";
import type { Order } from "@/features/orders/schema";
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

  describe("digest", () => {
  function emailOrder(overrides: Partial<Order> = {}): Order {
    return {
      id: "order-email-1",
      menuId: "menu-1",
      menuTitle: "Bistro Four",
      tableLabel: "4",
      currency: "USD",
      note: "Allergy: nuts",
      lines: [
        {
          menuItemId: "item-1",
          name: "Flat <b>white</b>",
          variantName: "Large",
          unitPrice: 4.5,
          quantity: 2,
          menuId: null,
          menuTitle: null,
        },
      ],
      status: "new",
      createdAt: "2026-10-24T10:00:00.000Z",
      updatedAt: "2026-10-24T10:00:00.000Z",
      ...overrides,
    };
  }

  function built(overrides: Partial<Order> = {}) {
    return buildNewOrderEmail({
      email: "till@cafe.test",
      restaurantName: "Bistro Four",
      order: emailOrder(overrides),
      boardUrl: "https://cafe.test/orders",
    });
  }

  it("names the table and totals the lines", () => {
    const content = built();
    expect(content.subject).toContain("Table 4");
    expect(content.subject).toContain("Bistro Four");
    expect(content.text).toContain("2× Flat <b>white</b> (Large)");
    expect(content.text).toContain("USD 9.00");
    expect(content.html).toContain("https://cafe.test/orders");
  });

  it("escapes item HTML and stays honest about unpriced lines", () => {
    const content = built({
      lines: [
        {
          menuItemId: "item-9",
          name: "Market <script>fish</script>",
          variantName: null,
          unitPrice: null,
          quantity: 1,
          menuId: null,
          menuTitle: null,
        },
      ],
      note: null,
    });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("Market &lt;script&gt;fish&lt;/script&gt;");
    expect(content.text).toContain("Total to confirm at the counter");
  });
});

describe("order alerts digest", () => {
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

  describe("hook", () => {
    const request = new Request("http://test.local/");

    function placedOrder(): Order {
      return {
        id: `order-hook-${Math.random().toString(36).slice(2)}`,
        menuId: "menu-1",
        menuTitle: "Cafe Alerts",
        tableLabel: "4",
        currency: "USD",
        note: null,
        lines: [
          {
            menuItemId: "item-1",
            name: "Flat white",
            variantName: null,
            unitPrice: 4.5,
            quantity: 1,
            menuId: null,
            menuTitle: null,
          },
        ],
        status: "new",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    it("sends to the owners by default and logs the send", async () => {
      const sent: NewOrderEmail[] = [];
      const outcome = await maybeEmailNewOrder(db, placedOrder(), restaurantId, "Cafe", request, {
        sendEmail: async (input) => {
          sent.push(input);
        },
      });
      expect(outcome).toEqual({ mailed: true });
      expect(sent.map((input) => input.email)).toEqual(["alerts-owner@cafe.test"]);
    });

    it("prefers the override address and skips silently when disabled", async () => {
      await updateOrderAlertPrefsForOwner(db, owner, restaurantId, {
        enabled: true,
        email: "till@cafe.test",
      });
      const sent: NewOrderEmail[] = [];
      const ok = await maybeEmailNewOrder(db, placedOrder(), restaurantId, "Cafe", request, {
        sendEmail: async (input) => {
          sent.push(input);
        },
      });
      expect(ok).toEqual({ mailed: true });
      expect(sent.map((input) => input.email)).toEqual(["till@cafe.test"]);

      await updateOrderAlertPrefsForOwner(db, owner, restaurantId, {
        enabled: false,
        email: null,
      });
      const skipped: NewOrderEmail[] = [];
      const outcome = await maybeEmailNewOrder(db, placedOrder(), restaurantId, "Cafe", request, {
        sendEmail: async (input) => {
          skipped.push(input);
        },
      });
      expect(outcome).toEqual({ mailed: false, skipped: "disabled" });
      expect(skipped).toHaveLength(0);
    });

    it("a failed send leaves no log row and stays retryable", async () => {
      const order = placedOrder();
      const outcome = await maybeEmailNewOrder(db, order, restaurantId, "Cafe", request, {
        sendEmail: async () => {
          throw new Error("smtp down");
        },
      });
      expect(outcome).toEqual({ mailed: false, skipped: "failed" });
      expect(await wasOrderEmailed(db, order.id)).toBe(false);
    });
  });
});
