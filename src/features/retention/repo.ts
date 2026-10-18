/**
 * Retention, export, and account deletion (Step 11).
 *
 * - `purgeOldOrders` is the scheduled job: orders older than the window are
 *   deleted (lines cascade), and stale rate-limit windows are swept. It never
 *   touches menus, publications, or usage rows.
 * - `buildAccountExport` is the owner's copy of everything: account, menus,
 *   live publications (with the snapshot the public sees), and orders.
 * - `deleteAccountForUser` deletes the user row and lets Postgres cascades
 *   remove their restaurants, menus, revisions, publications, orders, and
 *   memberships — one statement, so a half-deleted account is impossible even
 *   on the HTTP driver. Restaurants they only *work* at survive.
 *
 * Every read is scoped through membership by the verified user id.
 */

import { desc, eq, inArray, lt } from "drizzle-orm";

import type { TenancyDb } from "@/features/tenancy/repo";
import {
  menu,
  menuRevision,
  order as orderTable,
  orderLine as orderLineTable,
  orderRateLimit,
  publishedMenu,
  restaurant,
  restaurantMembership,
  user,
} from "@/lib/db/schema";

export interface PurgeResult {
  orders: number;
  rateLimitWindows: number;
}

/** Delete orders created before `before`; return how much was removed. */
export async function purgeOldOrders(
  db: TenancyDb,
  before: Date,
  now: Date = new Date()
): Promise<PurgeResult> {
  const deleted = await db
    .delete(orderTable)
    .where(lt(orderTable.createdAt, before))
    .returning({ id: orderTable.id });

  // Fixed-window counters are only useful for about a minute; a day is a
  // generous sweep that keeps the table from accumulating forever.
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const swept = await db
    .delete(orderRateLimit)
    .where(lt(orderRateLimit.windowStart, staleBefore))
    .returning({ key: orderRateLimit.key });

  return { orders: deleted.length, rateLimitWindows: swept.length };
}

export interface AccountExport {
  exportedAt: string;
  account: { id: string; name: string; email: string; createdAt: string } | null;
  restaurants: Array<{
    id: string;
    name: string;
    slug: string | null;
    role: string;
    createdAt: string;
  }>;
  menus: Array<{
    id: string;
    restaurantId: string;
    title: string;
    currency: string | null;
    doc: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
  publications: Array<{
    menuId: string;
    slug: string;
    theme: string | null;
    layout: string | null;
    publishedAt: string | null;
    viewCount: number;
    liveDoc: unknown;
  }>;
  orders: Array<{
    id: string;
    restaurantId: string;
    menuId: string | null;
    menuTitle: string;
    tableLabel: string;
    note: string | null;
    currency: string | null;
    status: string;
    totalCents: number | null;
    createdAt: string;
    updatedAt: string;
    lines: Array<{
      menuItemId: string;
      name: string;
      variantName: string | null;
      unitPriceCents: number | null;
      quantity: number;
    }>;
  }>;
}

const iso = (value: Date): string => value.toISOString();

/** Everything one account can see, shaped for a JSON download. */
export async function buildAccountExport(
  db: TenancyDb,
  userId: string,
  now: Date = new Date()
): Promise<AccountExport> {
  const accountRows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  const account = accountRows[0];

  const restaurantRows = await db
    .select({
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      role: restaurantMembership.role,
      createdAt: restaurant.createdAt,
    })
    .from(restaurant)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, restaurant.id))
    .where(eq(restaurantMembership.userId, userId));

  const menuRows = await db
    .select({
      id: menu.id,
      restaurantId: menu.restaurantId,
      title: menu.title,
      currency: menu.currency,
      doc: menu.doc,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
    })
    .from(menu)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(eq(restaurantMembership.userId, userId));

  const publicationRows = await db
    .select({
      menuId: publishedMenu.menuId,
      slug: publishedMenu.slug,
      theme: menuRevision.theme,
      layout: menuRevision.layout,
      publishedAt: publishedMenu.publishedAt,
      viewCount: publishedMenu.viewCount,
      liveDoc: menuRevision.doc,
    })
    .from(publishedMenu)
    .innerJoin(
      restaurantMembership,
      eq(restaurantMembership.restaurantId, publishedMenu.restaurantId)
    )
    .leftJoin(menuRevision, eq(publishedMenu.liveRevisionId, menuRevision.id))
    .where(eq(restaurantMembership.userId, userId));

  const orderRows = await db
    .select({ order: orderTable })
    .from(orderTable)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, orderTable.restaurantId))
    .where(eq(restaurantMembership.userId, userId))
    .orderBy(desc(orderTable.createdAt));

  const orderIds = orderRows.map((entry) => entry.order.id);
  const lineRows =
    orderIds.length === 0
      ? []
      : await db
          .select({
            orderId: orderLineTable.orderId,
            menuItemId: orderLineTable.menuItemId,
            name: orderLineTable.name,
            variantName: orderLineTable.variantName,
            unitPriceCents: orderLineTable.unitPriceCents,
            quantity: orderLineTable.quantity,
          })
          .from(orderLineTable)
          .where(inArray(orderLineTable.orderId, orderIds));

  return {
    exportedAt: iso(now),
    account: account
      ? { ...account, createdAt: iso(account.createdAt) }
      : null,
    restaurants: restaurantRows.map((row) => ({ ...row, createdAt: iso(row.createdAt) })),
    menus: menuRows.map((row) => ({
      ...row,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    publications: publicationRows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
    })),
    orders: orderRows.map(({ order: row }) => ({
      id: row.id,
      restaurantId: row.restaurantId,
      menuId: row.menuId,
      menuTitle: row.menuTitle,
      tableLabel: row.tableLabel,
      note: row.note,
      currency: row.currency,
      status: row.status,
      totalCents: row.totalCents,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      lines: lineRows
        .filter((line) => line.orderId === row.id)
        .map((line) => ({
          menuItemId: line.menuItemId,
          name: line.name,
          variantName: line.variantName,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
        })),
    })),
  };
}

export interface DeleteAccountResult {
  deleted: boolean;
  /** Restaurants whose data disappeared with the account. */
  restaurants: number;
}

/**
 * Delete the account and the restaurants it created. Memberships at other
 * tenants go with the user row; those restaurants keep running.
 */
export async function deleteAccountForUser(
  db: TenancyDb,
  userId: string
): Promise<DeleteAccountResult> {
  const owned = await db
    .select({ id: restaurant.id })
    .from(restaurant)
    .where(eq(restaurant.createdBy, userId));

  const deleted = await db.delete(user).where(eq(user.id, userId)).returning({ id: user.id });
  if (deleted.length === 0) return { deleted: false, restaurants: 0 };
  return { deleted: true, restaurants: owned.length };
}

/** Guard for the scheduled route: only the caller holding the secret runs it. */
export function isCronAuthorized(
  authorization: string | null,
  secret: string | undefined = process.env.CRON_SECRET
): boolean {
  if (!secret) return false;
  return authorization === `Bearer ${secret}`;
}
