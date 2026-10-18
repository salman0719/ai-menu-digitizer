import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { restaurant, restaurantMembership } from "@/lib/db/schema";
import type { RestaurantRole, RestaurantWithRole } from "@/lib/db/schema";

/**
 * Tenancy repository — every function is scoped by `userId` so a signed-in
 * user can only ever see or touch restaurants they hold a membership for
 * (PHASE-2.md §3.1). Mutations additionally require the `owner` role; a
 * `staff` membership can read but never write. Never trust a client-supplied
 * owner id — callers pass the id from the verified session only.
 *
 * `TenancyDb` is the driver-agnostic Drizzle base class: the app uses the
 * Neon HTTP driver and tests use PGlite, both of which extend it.
 */

export type TenancyDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

const restaurantColumns = {
  id: restaurant.id,
  name: restaurant.name,
  slug: restaurant.slug,
  createdAt: restaurant.createdAt,
  updatedAt: restaurant.updatedAt,
} as const;
const membershipSelect = (db: TenancyDb) =>
  db
    .select({ ...restaurantColumns, role: restaurantMembership.role })
    .from(restaurant)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, restaurant.id));

/** All restaurants the user is owner or staff of, oldest first. */
export async function listRestaurantsForUser(
  db: TenancyDb,
  userId: string
): Promise<RestaurantWithRole[]> {
  return membershipSelect(db)
    .where(eq(restaurantMembership.userId, userId))
    .orderBy(asc(restaurant.createdAt));
}

/** One restaurant the user belongs to, or null (no leak of other tenants). */
export async function getRestaurantForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<RestaurantWithRole | null> {
  const rows = await membershipSelect(db).where(
    and(eq(restaurantMembership.userId, userId), eq(restaurant.id, restaurantId))
  );
  return rows[0] ?? null;
}

/**
 * Create a restaurant with the caller as its owner (single implicit
 * transaction via compensation: if the membership insert fails, the
 * restaurant row is removed again — no ownerless tenants).
 */
export async function createRestaurant(
  db: TenancyDb,
  userId: string,
  name: string
): Promise<RestaurantWithRole> {
  const id = crypto.randomUUID();
  await db.insert(restaurant).values({ id, name, createdBy: userId });
  try {
    await db.insert(restaurantMembership).values({ restaurantId: id, userId, role: "owner" });
  } catch (error) {
    await db
      .delete(restaurant)
      .where(and(eq(restaurant.id, id), eq(restaurant.createdBy, userId)))
      .catch(() => undefined);
    throw error;
  }
  const created = await getRestaurantForUser(db, userId, id);
  if (!created) {
    throw new Error("restaurant creation did not produce a membership");
  }
  return created;
}

/** Owner-only rename. Returns null when the user isn't a member or isn't an owner. */
export async function renameRestaurantForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  name: string
): Promise<RestaurantWithRole | null> {
  const role = await ownerRoleOf(db, userId, restaurantId);
  if (role !== "owner") return null;
  const updated = await db
    .update(restaurant)
    .set({ name })
    .where(eq(restaurant.id, restaurantId))
    .returning(restaurantColumns);
  const row = updated[0];
  return row ? { ...row, role } : null;
}

/** Owner-only delete (memberships cascade). False when not allowed / unknown. */
export async function deleteRestaurantForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<boolean> {
  const role = await ownerRoleOf(db, userId, restaurantId);
  if (role !== "owner") return false;
  const deleted = await db
    .delete(restaurant)
    .where(eq(restaurant.id, restaurantId))
    .returning({ id: restaurant.id });
  return deleted.length > 0;
}

/** The caller's role in the restaurant, or null if they are not a member. */
async function roleOf(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<RestaurantRole | null> {
  const rows = await db
    .select({ role: restaurantMembership.role })
    .from(restaurantMembership)
    .where(
      and(
        eq(restaurantMembership.userId, userId),
        eq(restaurantMembership.restaurantId, restaurantId)
      )
    );
  return rows[0]?.role ?? null;
}

async function ownerRoleOf(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<"owner" | null> {
  return (await roleOf(db, userId, restaurantId)) === "owner" ? "owner" : null;
}
