/**
 * Server-side launch snapshot: what the account actually has, so the
 * onboarding checklist reports facts rather than a guessed progress bar.
 *
 * Every query is scoped by the verified user id through membership (never a
 * client-supplied id), and review counts come from documents re-validated
 * with the canonical menu schema — an unreadable menu is counted, not hidden.
 */

import { and, count, desc, eq, isNotNull } from "drizzle-orm";

import { menuDocumentSchema } from "@/features/menu/schema";
import { publicationPath } from "@/features/publishing/schema";
import { ensureRestaurantSlug } from "@/features/tables/repo";
import type { TenancyDb } from "@/features/tenancy/repo";
import { menu, order, publishedMenu, restaurant, restaurantMembership } from "@/lib/db/schema";

import type { LaunchSnapshot } from "./schema";

export async function getLaunchSnapshot(
  db: TenancyDb,
  userId: string
): Promise<LaunchSnapshot> {
  const menus = await db
    .select({ id: menu.id, doc: menu.doc })
    .from(menu)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(eq(restaurantMembership.userId, userId));

  const publications = await db
    .select({
      restaurantId: publishedMenu.restaurantId,
      restaurantSlug: restaurant.slug,
      slug: publishedMenu.slug,
      publishedAt: publishedMenu.publishedAt,
    })
    .from(publishedMenu)
    .innerJoin(
      restaurantMembership,
      eq(restaurantMembership.restaurantId, publishedMenu.restaurantId)
    )
    .innerJoin(restaurant, eq(restaurant.id, publishedMenu.restaurantId))
    .where(and(eq(restaurantMembership.userId, userId), isNotNull(publishedMenu.publishedAt)))
    .orderBy(desc(publishedMenu.publishedAt));

  const orders = await db
    .select({ value: count() })
    .from(order)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, order.restaurantId))
    .where(eq(restaurantMembership.userId, userId));

  let unpricedItems = 0;
  let reviewNotes = 0;
  let unreadableMenus = 0;
  for (const row of menus) {
    const parsed = menuDocumentSchema.safeParse(row.doc);
    if (!parsed.success) {
      unreadableMenus += 1;
      continue;
    }
    for (const category of parsed.data.categories) {
      for (const item of category.items) {
        if (item.price === null) unpricedItems += 1;
        if (item.reviewNotes.length > 0) reviewNotes += 1;
      }
    }
  }

  // The most recently published live menu, addressed the way a visitor opens
  // it. A café that published before claiming its `/r/` address claims it
  // here — the checklist link has to point somewhere real.
  const live = publications[0] ?? null;
  let livePath: string | null = null;
  if (live) {
    const restaurantSlug =
      live.restaurantSlug ?? (await ensureRestaurantSlug(db, live.restaurantId)).slug;
    livePath = publicationPath(restaurantSlug, live.slug);
  }

  return {
    menuCount: menus.length,
    publishedCount: publications.length,
    livePath,
    orderCount: Number(orders[0]?.value ?? 0),
    unpricedItems,
    reviewNotes,
    unreadableMenus,
  };
}
