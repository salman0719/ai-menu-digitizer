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
import type { TenancyDb } from "@/features/tenancy/repo";
import { menu, order, publishedMenu, restaurantMembership } from "@/lib/db/schema";

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
    .select({ slug: publishedMenu.slug, publishedAt: publishedMenu.publishedAt })
    .from(publishedMenu)
    .innerJoin(
      restaurantMembership,
      eq(restaurantMembership.restaurantId, publishedMenu.restaurantId)
    )
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

  return {
    menuCount: menus.length,
    publishedCount: publications.length,
    liveSlug: publications[0]?.slug ?? null,
    orderCount: Number(orders[0]?.value ?? 0),
    unpricedItems,
    reviewNotes,
    unreadableMenus,
  };
}
