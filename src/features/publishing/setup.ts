import { and, eq } from "drizzle-orm";

import { menu, restaurant, restaurantMembership } from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import { menuDocumentSchema } from "@/features/menu/schema";
import { createMenuForUser, MenuRepoError } from "@/features/menus/repo";
import { createRestaurant, listRestaurantsForUser, type TenancyDb } from "@/features/tenancy/repo";

import { PublicationRepoError, publishMenuForUser } from "./repo";
import type { PublishSetupInput, PublishSetupResult } from "./setup-schema";

/**
 * One-submit publish setup for the R1 wizard.
 *
 * The wizard's promise is "draft in this browser → live link", and the only
 * server invariant it changes is this: when the caller owns no restaurant at
 * all, the restaurant is created from the name they confirmed in the wizard
 * instead of being a separate manual step. When they do own one (or several)
 * the existing restaurant is used — this function never adds a second one
 * behind their back.
 *
 * Idempotency matters because the three writes happen sequentially and the
 * Neon HTTP driver has no interactive transaction: a retry after a partial
 * failure reuses the restaurant that already exists, attaches the menu only
 * if it is missing, and republishes. `created` reports what *this* request
 * added.
 *
 * A menu that is already in the account is published from its stored
 * revision, never overwritten from a client-supplied document. That keeps a
 * retry safe and means a stale local copy can never silently replace newer
 * account edits.
 */

interface MenuForUser {
  restaurantId: string;
  restaurantName: string;
  role: RestaurantRole;
}

async function findMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<MenuForUser | null> {
  const rows = await db
    .select({
      restaurantId: menu.restaurantId,
      restaurantName: restaurant.name,
      role: restaurantMembership.role,
    })
    .from(menu)
    .innerJoin(restaurant, eq(restaurant.id, menu.restaurantId))
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId)));
  return rows[0] ?? null;
}

/** True when the id is taken by a menu, even one in another tenant. */
async function anyMenuUsesId(db: TenancyDb, menuId: string): Promise<boolean> {
  const rows = await db.select({ id: menu.id }).from(menu).where(eq(menu.id, menuId));
  return rows.length > 0;
}

function invalid(message: string): PublicationRepoError {
  return new PublicationRepoError("invalid", message);
}

function mapMenuError(error: MenuRepoError): PublicationRepoError {
  switch (error.code) {
    case "forbidden":
      return new PublicationRepoError("forbidden", error.message);
    case "not_found":
      return new PublicationRepoError("not_found", error.message);
    case "invalid_doc":
    case "stale":
    case "exists":
    default:
      return invalid(error.message);
  }
}

export async function publishMenuWithSetupForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  input: PublishSetupInput
): Promise<PublishSetupResult> {
  const existing = await findMenuForUser(db, userId, menuId);
  let target: { id: string; name: string };
  let createdRestaurant = false;
  let createdMenu = false;

  if (existing) {
    if (existing.role !== "owner") {
      throw new PublicationRepoError(
        "forbidden",
        "Only the restaurant owner can publish this menu."
      );
    }
    if (input.restaurantId && input.restaurantId !== existing.restaurantId) {
      throw invalid("This menu already belongs to another restaurant.");
    }
    target = { id: existing.restaurantId, name: existing.restaurantName };
  } else {
    // An id that belongs to someone else's menu is 404, exactly like a menu
    // that does not exist — ids across tenants stay unprobeable.
    if (await anyMenuUsesId(db, menuId)) {
      throw new PublicationRepoError("not_found", "That menu does not exist.");
    }
    if (!input.doc) {
      throw invalid("The menu draft is missing. Open it in the editor and try again.");
    }
    const parsedDoc = menuDocumentSchema.safeParse(input.doc);
    if (!parsedDoc.success) {
      throw invalid(parsedDoc.error.issues[0]?.message ?? "This menu is not valid.");
    }
    if (parsedDoc.data.id !== menuId) {
      throw invalid("The menu draft does not match the menu being published.");
    }

    const owned = (await listRestaurantsForUser(db, userId)).filter(
      (candidate) => candidate.role === "owner"
    );

    if (input.restaurantId) {
      const chosen = owned.find((candidate) => candidate.id === input.restaurantId);
      if (!chosen) {
        throw new PublicationRepoError("not_found", "That restaurant does not exist.");
      }
      target = { id: chosen.id, name: chosen.name };
    } else if (owned.length === 1 && owned[0]) {
      target = { id: owned[0].id, name: owned[0].name };
    } else if (owned.length > 1) {
      throw invalid("Choose which restaurant this menu belongs to.");
    } else {
      const name = input.restaurantName?.trim();
      if (!name) {
        throw invalid("Name your restaurant to publish this menu.");
      }
      if (name.length > 120) {
        throw invalid("Keep the restaurant name to 120 characters or fewer.");
      }
      const created = await createRestaurant(db, userId, name);
      target = { id: created.id, name: created.name };
      createdRestaurant = true;
    }

    try {
      await createMenuForUser(db, userId, target.id, parsedDoc.data);
      createdMenu = true;
    } catch (error) {
      if (error instanceof MenuRepoError && error.code === "exists") {
        // A concurrent retry created the row between our checks. Continue
        // only if it is the same café and the caller still owns it.
        const raced = await findMenuForUser(db, userId, menuId);
        if (!raced || raced.role !== "owner" || raced.restaurantId !== target.id) {
          throw new PublicationRepoError("not_found", "That menu does not exist.");
        }
        createdMenu = false;
      } else if (error instanceof MenuRepoError) {
        throw mapMenuError(error);
      } else {
        throw error;
      }
    }
  }

  const publication = await publishMenuForUser(db, userId, menuId, {
    theme: input.theme,
    layout: input.layout,
    ...(input.slug ? { slug: input.slug } : {}),
  });

  return {
    publication,
    restaurant: target,
    created: { restaurant: createdRestaurant, menu: createdMenu },
  };
}
