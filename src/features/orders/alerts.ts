import { and, eq, gte } from "drizzle-orm";

import {
  orderEmailLog,
  restaurant as restaurantTable,
  restaurantMembership,
  user as userTable,
} from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";

/**
 * New-order email alerts (R0.4, report 5 tier 3): per-restaurant preference,
 * one email per order, and a digest guard for rushes.
 *
 * - Preferences live on the restaurant: `order_alerts_enabled` (default on)
 *   plus an optional `order_alert_email` override. Without an override the
 *   mail goes to the owners' account emails.
 * - Reads are member-scoped (any role); writes are owner-only, mirroring
 *   the tenancy repo. A foreign id reads as null, never as forbidden.
 * - `recordOrderEmailAttempt` is the idempotency + digest gate: the unique
 *   order id means a retried placement never double-emails, and past
 *   `DIGEST_THRESHOLD` sends in the trailing `DIGEST_WINDOW_MINUTES` the
 *   mail is skipped (the board and the in-app monitor still catch it).
 */

export interface OrderAlertPrefs {
  enabled: boolean;
  /** Override recipient; null means the owners' account emails. */
  email: string | null;
}

/** Rush guard: more than this many emails in the window skips the mail. */
export const ORDER_EMAIL_DIGEST_THRESHOLD = 5;
export const ORDER_EMAIL_DIGEST_WINDOW_MINUTES = 10;

const prefsColumns = {
  enabled: restaurantTable.orderAlertsEnabled,
  email: restaurantTable.orderAlertEmail,
} as const;

/** Alert prefs for a restaurant the caller belongs to, or null across tenants. */
export async function getOrderAlertPrefs(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<(OrderAlertPrefs & { role: "owner" | "staff" }) | null> {
  const rows = await db
    .select({ ...prefsColumns, role: restaurantMembership.role })
    .from(restaurantTable)
    .innerJoin(
      restaurantMembership,
      and(
        eq(restaurantMembership.restaurantId, restaurantTable.id),
        eq(restaurantMembership.userId, userId)
      )
    )
    .where(eq(restaurantTable.id, restaurantId))
    .limit(1);
  const row = rows[0];
  return row ? { enabled: row.enabled, email: row.email, role: row.role } : null;
}

/**
 * Owner-only alert preference write. Returns null when the caller may not
 * write (non-member or staff). The email override is already validated by
 * the API boundary; an empty string clears it back to the owners' emails.
 */
export async function updateOrderAlertPrefsForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  prefs: { enabled: boolean; email: string | null }
): Promise<OrderAlertPrefs | null> {
  const membership = await db
    .select({ role: restaurantMembership.role })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.restaurantId, restaurantId),
        eq(restaurantMembership.userId, userId)
      )
    )
    .limit(1);
  if (membership[0]?.role !== "owner") return null;
  const updated = await db
    .update(restaurantTable)
    .set({ orderAlertsEnabled: prefs.enabled, orderAlertEmail: prefs.email })
    .where(eq(restaurantTable.id, restaurantId))
    .returning(prefsColumns);
  const row = updated[0];
  return row ? { enabled: row.enabled, email: row.email } : null;
}

/** Account emails of every owner — the default recipients. Internal use. */
export async function listOwnerEmails(
  db: TenancyDb,
  restaurantId: string
): Promise<string[]> {
  const rows = await db
    .select({ email: userTable.email })
    .from(restaurantMembership)
    .innerJoin(userTable, eq(userTable.id, restaurantMembership.userId))
    .where(
      and(
        eq(restaurantMembership.restaurantId, restaurantId),
        eq(restaurantMembership.role, "owner")
      )
    );
  return [...new Set(rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean))];
}

export type OrderEmailAttempt =
  | { mailed: true }
  | { mailed: false; reason: "duplicate" | "digest" };

/**
 * Idempotent send gate: records the email for this order, or refuses with
 * the reason. Call only after the Resend call succeeds — a failed send must
 * stay retryable, never counted.
 */
export async function recordOrderEmailAttempt(
  db: TenancyDb,
  restaurantId: string,
  orderId: string,
  email: string,
  now: Date = new Date()
): Promise<OrderEmailAttempt> {
  const windowStart = new Date(now.getTime() - ORDER_EMAIL_DIGEST_WINDOW_MINUTES * 60_000);
  const recent = await db
    .select({ id: orderEmailLog.id })
    .from(orderEmailLog)
    .where(
      and(
        eq(orderEmailLog.restaurantId, restaurantId),
        gte(orderEmailLog.sentAt, windowStart)
      )
    );
  if (recent.length >= ORDER_EMAIL_DIGEST_THRESHOLD) {
    return { mailed: false, reason: "digest" };
  }
  try {
    // Stamp the caller's clock, not the database's: the digest window above
    // is computed from the same `now`, so the two can never disagree
    // (and tests can time-travel deterministically).
    await db.insert(orderEmailLog).values({ restaurantId, orderId, email, sentAt: now });
  } catch {
    // Unique order id: this order already mailed (a retried placement).
    const existing = await db
      .select({ id: orderEmailLog.id })
      .from(orderEmailLog)
      .where(eq(orderEmailLog.orderId, orderId))
      .limit(1);
    if (existing.length > 0) return { mailed: false, reason: "duplicate" };
    throw new Error("order email log insert failed");
  }
  return { mailed: true };
}
/** Duplicate check for tests: was this order mailed? */
export async function wasOrderEmailed(db: TenancyDb, orderId: string): Promise<boolean> {
  const rows = await db
    .select({ id: orderEmailLog.id })
    .from(orderEmailLog)
    .where(eq(orderEmailLog.orderId, orderId))
    .limit(1);
  return rows.length > 0;
}
