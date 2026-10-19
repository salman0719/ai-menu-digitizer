import { and, asc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { restaurant, restaurantMembership, user } from "@/lib/db/schema";
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

/**
 * Errors for member management, mirroring MenuRepoError: callers map codes
 * to HTTP, messages are safe to show a user, nothing internal leaks.
 */
export type TenancyRepoErrorCode =
  | "not_found"
  | "forbidden"
  | "user_not_found"
  | "already_member"
  | "last_owner";

export class TenancyRepoError extends Error {
  readonly code: TenancyRepoErrorCode;

  constructor(code: TenancyRepoErrorCode, message: string) {
    super(message);
    this.name = "TenancyRepoError";
    this.code = code;
  }
}

/** A member as seen by their team: account info plus the restaurant role. */
export interface RestaurantMember {
  userId: string;
  name: string;
  email: string;
  role: RestaurantRole;
}

const memberSelect = (db: TenancyDb) =>
  db
    .select({
      userId: restaurantMembership.userId,
      name: user.name,
      email: user.email,
      role: restaurantMembership.role,
    })
    .from(restaurantMembership)
    .innerJoin(user, eq(user.id, restaurantMembership.userId));

/**
 * Owner gate for member management. Non-members get `not_found` (ids stay
 * unprobeable across tenants), staff gets `forbidden`.
 */
async function requireOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<"owner"> {
  const role = await roleOf(db, userId, restaurantId);
  if (role === null) throw new TenancyRepoError("not_found", "That restaurant does not exist.");
  if (role !== "owner") {
    throw new TenancyRepoError("forbidden", "Only the restaurant owner can manage members.");
  }
  return "owner";
}

/**
 * "Some owner other than `userId` exists" — the guard that keeps a
 * restaurant from ever losing its last owner. As a subquery it travels with
 * the UPDATE/DELETE itself, so the check and the write are one statement
 * (the Neon HTTP driver has no interactive transactions).
 */
function anotherOwnerExists(restaurantId: string, userId: string) {
  return sql`(select count(*) from ${restaurantMembership} where ${restaurantMembership.restaurantId} = ${restaurantId} and ${restaurantMembership.role} = 'owner' and ${restaurantMembership.userId} <> ${userId}) > 0`;
}

/** The members of a restaurant the caller belongs to (any role). */
export async function listMembersForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<RestaurantMember[]> {
  const member = await getRestaurantForUser(db, userId, restaurantId);
  if (!member) throw new TenancyRepoError("not_found", "That restaurant does not exist.");
  return memberSelect(db)
    .where(eq(restaurantMembership.restaurantId, restaurantId))
    .orderBy(asc(restaurantMembership.createdAt));
}

/**
 * Owner-only: add an existing account (found by email) as owner or staff.
 * There is no invitation flow yet — the person must have signed in once.
 */
export async function addMemberForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  email: string,
  role: RestaurantRole
): Promise<RestaurantMember> {
  await requireOwner(db, userId, restaurantId);

  const accounts = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email.trim()})`)
    .limit(1);
  const target = accounts[0];
  if (!target) {
    throw new TenancyRepoError(
      "user_not_found",
      "No account uses that email yet — ask them to sign in once first."
    );
  }
  if (await getMember(db, restaurantId, target.id)) {
    throw new TenancyRepoError("already_member", "That account already belongs to this restaurant.");
  }

  try {
    await db.insert(restaurantMembership).values({ restaurantId, userId: target.id, role });
  } catch {
    // Unique (restaurant, user) index — a concurrent add won the race.
    throw new TenancyRepoError("already_member", "That account already belongs to this restaurant.");
  }
  return { userId: target.id, name: target.name, email: target.email, role };
}

/**
 * Owner-only role change. Demoting an owner is refused unless another owner
 * remains — a restaurant never ends up ownerless (race-safe: the guard is
 * part of the UPDATE statement itself).
 */
export async function updateMemberRoleForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  targetUserId: string,
  role: RestaurantRole
): Promise<RestaurantMember> {
  await requireOwner(db, userId, restaurantId);

  const target = await getMember(db, restaurantId, targetUserId);
  if (!target) {
    throw new TenancyRepoError("not_found", "That member does not belong to this restaurant.");
  }
  if (target.role === role) return target;

  if (target.role === "owner") {
    const updated = await db
      .update(restaurantMembership)
      .set({ role })
      .where(
        and(
          eq(restaurantMembership.restaurantId, restaurantId),
          eq(restaurantMembership.userId, targetUserId),
          anotherOwnerExists(restaurantId, targetUserId)
        )
      )
      .returning({ userId: restaurantMembership.userId });
    if (updated.length === 0) {
      throw new TenancyRepoError("last_owner", "A restaurant needs at least one owner.");
    }
  } else {
    await db
      .update(restaurantMembership)
      .set({ role })
      .where(
        and(
          eq(restaurantMembership.restaurantId, restaurantId),
          eq(restaurantMembership.userId, targetUserId)
        )
      );
  }
  const changed = await getMember(db, restaurantId, targetUserId);
  if (!changed) throw new TenancyRepoError("not_found", "That member does not belong to this restaurant.");
  return changed;
}

/**
 * Owner-only removal, with the same last-owner guard as demotion.
 */
export async function removeMemberForOwner(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  targetUserId: string
): Promise<void> {
  await requireOwner(db, userId, restaurantId);

  const target = await getMember(db, restaurantId, targetUserId);
  if (!target) {
    throw new TenancyRepoError("not_found", "That member does not belong to this restaurant.");
  }

  const filter = and(
    eq(restaurantMembership.restaurantId, restaurantId),
    eq(restaurantMembership.userId, targetUserId)
  );
  if (target.role === "owner") {
    const removed = await db
      .delete(restaurantMembership)
      .where(and(filter, anotherOwnerExists(restaurantId, targetUserId)))
      .returning({ userId: restaurantMembership.userId });
    if (removed.length === 0) {
      throw new TenancyRepoError("last_owner", "A restaurant needs at least one owner.");
    }
  } else {
    await db.delete(restaurantMembership).where(filter);
  }
}

/** One member with their account info, or null. */
async function getMember(
  db: TenancyDb,
  restaurantId: string,
  memberUserId: string
): Promise<RestaurantMember | null> {
  const rows = await memberSelect(db).where(
    and(
      eq(restaurantMembership.restaurantId, restaurantId),
      eq(restaurantMembership.userId, memberUserId)
    )
  );
  return rows[0] ?? null;
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
