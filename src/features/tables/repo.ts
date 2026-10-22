import { and, asc, eq, isNotNull } from "drizzle-orm";

import {
  menu,
  menuRevision,
  publishedMenu,
  restaurant,
  restaurantMembership,
} from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import {
  isPreviewLayoutId,
  isPreviewThemeId,
  type PreviewLayoutId,
  type PreviewThemeId,
} from "@/features/menu/preview-themes";
import { menuSlugSchema } from "@/features/publishing/schema";
import { isSlug, slugCandidates, slugifyMenuTitle } from "@/features/publishing/slug";
import {
  isTimeZone,
  menuAvailabilitySchema,
  type MenuAvailability,
} from "@/features/availability/schema";
import { isMenuOpenAt } from "@/features/availability/open-at";

/**
 * Server repository for the multi-menu table landing
 * (`/r/[restaurant]/t/[table]`, Steps 1–2).
 *
 * One QR code per table resolves to the *restaurant*, and the diner sees
 * every currently-open menu — not one menu per code. "Open" means two
 * things at once: the menu is published and live (Step 9 snapshot), and
 * its availability windows cover `now` (empty schedule = always open).
 *
 * Tenancy mirrors the menu repo: availability and slug writes are
 * owner-only and scoped by membership (unknown ids report `not_found`),
 * while the landing reads (`getRestaurantBySlug`,
 * `listOpenMenusForRestaurantSlug`) are public — a diner has no account.
 */

export type TableRepoErrorCode = "not_found" | "forbidden" | "invalid" | "slug_taken";

export class TableRepoError extends Error {
  readonly code: TableRepoErrorCode;

  constructor(code: TableRepoErrorCode, message: string) {
    super(message);
    this.name = "TableRepoError";
    this.code = code;
  }
}

/** One open menu on the table landing: snapshot plus its address. */
export interface OpenMenuEntry {
  menuId: string;
  /** The menu's own address segment inside the restaurant. */
  menuSlug: string;
  title: string;
  doc: MenuDocument;
  theme: PreviewThemeId;
  layout: PreviewLayoutId;
  publishedAt: string;
  availability: MenuAvailability;
}

/** A restaurant's table landing: identity plus zero or more open menus. */
export interface TableLanding {
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  menus: OpenMenuEntry[];
}

function parseAvailability(menuId: string, value: unknown): MenuAvailability {
  const parsed = menuAvailabilitySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`stored menu ${menuId} has invalid availability`);
  }
  return parsed.data;
}

/** The zone a restaurant's opening windows are written in (null = UTC). */
export async function getRestaurantTimeZoneForMenu(
  db: TenancyDb,
  menuId: string
): Promise<string | null> {
  const rows = await db
    .select({ timeZone: restaurant.timeZone })
    .from(menu)
    .innerJoin(restaurant, eq(restaurant.id, menu.restaurantId))
    .where(eq(menu.id, menuId));
  return rows[0]?.timeZone ?? null;
}

/**
 * Owner-only: replace a menu's opening windows (empty = always open), and
 * optionally the zone those wall-clock times are written in. `timeZone`
 * of `undefined` leaves the stored zone untouched, `null` clears it (the
 * UTC fallback), and a string replaces it after an IANA check, so a
 * client cannot poison the restaurant's hours.
 */
export async function setMenuAvailabilityForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  windows: unknown,
  timeZone?: string | null
): Promise<{ availability: MenuAvailability; timeZone: string | null }> {
  const rows = await db
    .select({
      id: menu.id,
      restaurantId: menu.restaurantId,
      role: restaurantMembership.role,
    })
    .from(menu)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId)));
  const row = rows[0];
  if (!row) throw new TableRepoError("not_found", "That menu does not exist.");
  if (row.role !== "owner") {
    throw new TableRepoError("forbidden", "Only the restaurant owner can set opening times.");
  }
  const parsed = menuAvailabilitySchema.safeParse(windows);
  if (!parsed.success) {
    throw new TableRepoError(
      "invalid",
      parsed.error.issues[0]?.message ?? "Those opening times are not valid."
    );
  }
  if (timeZone !== undefined && timeZone !== null && !isTimeZone(timeZone)) {
    throw new TableRepoError("invalid", "That time zone is not recognised.");
  }
  // Availability lives outside `doc` and `updatedAt` on purpose: a time
  // change takes effect on the landing immediately, without republishing,
  // and never shows up as "unpublished changes".
  await db.update(menu).set({ availability: parsed.data }).where(eq(menu.id, menuId));
  if (timeZone !== undefined) {
    await db
      .update(restaurant)
      .set({ timeZone })
      .where(eq(restaurant.id, row.restaurantId));
  }
  return {
    availability: parsed.data,
    timeZone: await getRestaurantTimeZoneForMenu(db, menuId),
  };
}

/** Postgres unique-violation detection (Neon and PGlite both report 23505). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (candidate.code === "23505") return true;
  if (typeof candidate.message === "string" && /duplicate key|unique constraint/i.test(candidate.message)) {
    return true;
  }
  return candidate.cause !== error && isUniqueViolation(candidate.cause);
}

/** Owner-only: set (or change) the restaurant's public `/r/<slug>` address. */
export async function setRestaurantSlugForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  slug: string
): Promise<{ id: string; name: string; slug: string }> {
  const role = await roleOf(db, userId, restaurantId);
  if (role === null) throw new TableRepoError("not_found", "That restaurant does not exist.");
  if (role !== "owner") {
    throw new TableRepoError("forbidden", "Only the restaurant owner can change its link.");
  }
  const parsed = menuSlugSchema.safeParse(slug);
  if (!parsed.success) {
    throw new TableRepoError(
      "invalid",
      parsed.error.issues[0]?.message ?? "That link is not valid."
    );
  }
  if (await restaurantSlugTakenByAnother(db, parsed.data, restaurantId)) {
    throw new TableRepoError("slug_taken", "That link is already used by another restaurant.");
  }
  try {
    const updated = await db
      .update(restaurant)
      .set({ slug: parsed.data })
      .where(eq(restaurant.id, restaurantId))
      .returning({ id: restaurant.id, name: restaurant.name, slug: restaurant.slug });
    const row = updated[0];
    if (!row || !row.slug) throw new Error("setting the restaurant link did not persist");
    return { id: row.id, name: row.name, slug: row.slug };
  } catch (error) {
    if (error instanceof TableRepoError) throw error;
    if (isUniqueViolation(error)) {
      throw new TableRepoError("slug_taken", "That link was just taken. Try another.");
    }
    throw error;
  }
}

/**
 * Claim the restaurant's public `/r/<slug>` address from its name when it
 * has none yet (first free candidate wins, same as menu publishing).
 *
 * No role check — callers must have already established the right to touch
 * this restaurant (the owner-only wrapper below, or a publishing call that
 * already verified membership). Idempotent: an existing slug is returned
 * untouched, and a concurrent claim loses the race on the unique index and
 * retries the next candidate. Publishing needs the address to build menu
 * links, so the invariant "a restaurant with a publication has a slug" is
 * restored through this function.
 */
export async function ensureRestaurantSlug(
  db: TenancyDb,
  restaurantId: string
): Promise<{ id: string; name: string; slug: string }> {
  const current = await db
    .select({ id: restaurant.id, name: restaurant.name, slug: restaurant.slug })
    .from(restaurant)
    .where(eq(restaurant.id, restaurantId));
  const row = current[0];
  if (!row) throw new TableRepoError("not_found", "That restaurant does not exist.");
  if (row.slug) return { id: row.id, name: row.name, slug: row.slug };
  for (const candidate of slugCandidates(slugifyMenuTitle(row.name))) {
    if (await restaurantSlugTakenByAnother(db, candidate, restaurantId)) continue;
    try {
      const updated = await db
        .update(restaurant)
        .set({ slug: candidate })
        .where(eq(restaurant.id, restaurantId))
        .returning({ id: restaurant.id, name: restaurant.name, slug: restaurant.slug });
      const saved = updated[0];
      if (saved?.slug) return { id: saved.id, name: saved.name, slug: saved.slug };
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new TableRepoError("slug_taken", "Could not find a free link for this restaurant.");
}

/**
 * Owner-only: claim a public address derived from the restaurant's name when
 * it has none yet (first free candidate wins, same as menu publishing).
 * Returns the existing slug untouched when one is already set.
 */
export async function ensureRestaurantSlugForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<{ id: string; name: string; slug: string }> {
  const role = await roleOf(db, userId, restaurantId);
  if (role === null) throw new TableRepoError("not_found", "That restaurant does not exist.");
  if (role !== "owner") {
    throw new TableRepoError("forbidden", "Only the restaurant owner can change its link.");
  }
  return ensureRestaurantSlug(db, restaurantId);
}

async function restaurantSlugTakenByAnother(
  db: TenancyDb,
  slug: string,
  restaurantId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: restaurant.id })
    .from(restaurant)
    .where(eq(restaurant.slug, slug));
  return rows.some((row) => row.id !== restaurantId);
}

async function roleOf(
  db: TenancyDb,
  userId: string,
  restaurantId: string
): Promise<"owner" | "staff" | null> {
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

/** Public: a restaurant by its `/r/<slug>` address, or null. */
export async function getRestaurantBySlug(
  db: TenancyDb,
  slug: string
): Promise<{ id: string; name: string; slug: string } | null> {
  if (!isSlug(slug)) return null;
  const rows = await db
    .select({ id: restaurant.id, name: restaurant.name, slug: restaurant.slug })
    .from(restaurant)
    .where(eq(restaurant.slug, slug));
  const row = rows[0];
  if (!row || !row.slug) return null;
  return { id: row.id, name: row.name, slug: row.slug };
}

/**
 * Public: the table landing for a restaurant slug — every *live* published
 * menu whose availability covers `now`, judged in the restaurant's own
 * zone (`restaurant.time_zone`, null = UTC) so "9 to 5" means the café's
 * 9 to 5 rather than UTC's. The `timeZone` argument is only the fallback
 * for a restaurant that has never saved hours. Null when the slug names
 * no restaurant (callers render a 404); a known restaurant with nothing
 * open returns an empty `menus` list so the page can say so honestly.
 */
export async function listOpenMenusForRestaurantSlug(
  db: TenancyDb,
  restaurantSlug: string,
  now: Date = new Date(),
  timeZone = "UTC"
): Promise<TableLanding | null> {
  const found = await getRestaurantBySlug(db, restaurantSlug);
  if (!found) return null;

  const rows = await db
    .select({
      menuId: menu.id,
      menuSlug: publishedMenu.slug,
      title: menu.title,
      doc: menuRevision.doc,
      theme: menuRevision.theme,
      layout: menuRevision.layout,
      publishedAt: publishedMenu.publishedAt,
      availability: menu.availability,
      timeZone: restaurant.timeZone,
    })
    .from(publishedMenu)
    .innerJoin(menu, eq(menu.id, publishedMenu.menuId))
    .innerJoin(menuRevision, eq(menuRevision.id, publishedMenu.liveRevisionId))
    .innerJoin(restaurant, eq(restaurant.id, publishedMenu.restaurantId))
    .where(
      and(
        eq(publishedMenu.restaurantId, found.id),
        isNotNull(publishedMenu.publishedAt),
        isNotNull(publishedMenu.liveRevisionId)
      )
    )
    .orderBy(asc(menu.title), asc(menu.id));

  const menus: OpenMenuEntry[] = [];
  for (const row of rows) {
    if (row.publishedAt === null) continue;
    const parsedDoc = menuDocumentSchema.safeParse(row.doc);
    if (!parsedDoc.success) {
      throw new Error(`published menu ${row.menuSlug} failed canonical schema validation`);
    }
    if (!isPreviewThemeId(row.theme) || !isPreviewLayoutId(row.layout)) {
      throw new Error(`published menu ${row.menuSlug} has an unknown theme or layout`);
    }
    const availability = parseAvailability(row.menuId, row.availability);
    // Wall-clock windows only mean something in the restaurant's zone;
    // a restaurant that has never saved hours keeps the UTC fallback.
    if (!isMenuOpenAt(availability, now, row.timeZone ?? timeZone)) continue;
    menus.push({
      menuId: row.menuId,
      menuSlug: row.menuSlug,
      title: row.title,
      doc: parsedDoc.data,
      theme: row.theme,
      layout: row.layout,
      publishedAt: row.publishedAt.toISOString(),
      availability,
    });
  }

  return {
    restaurantId: found.id,
    restaurantName: found.name,
    restaurantSlug: found.slug,
    menus,
  };
}

/** Public table-landing path for a restaurant slug — the QR target shape. */
export { restaurantTablePath } from "@/features/orders/table-links";
