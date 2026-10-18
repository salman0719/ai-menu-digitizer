import { and, asc, desc, eq } from "drizzle-orm";

import { menu, restaurant, restaurantMembership } from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";

/**
 * Server repository for menu documents (Step 8 — server-backed menus).
 *
 * Tenancy rules (PHASE-2.md §3.1), enforced here and nowhere else:
 * - Reads require an owner OR staff membership on the menu's restaurant.
 * - Mutations (create/update/delete) require the owner role, matching the
 *   restaurants repo: staff can read but never write.
 * - The userId always comes from the verified session, never from a client
 *   payload. A menu in a restaurant the caller doesn't belong to is
 *   reported as `not_found` — never `forbidden` — so ids of other tenants
 *   cannot be probed.
 *
 * Conflict detection: `updateMenuForUser` only writes when the row's
 * `updated_at` still equals the caller's `expectedUpdatedAt` (a conditional
 * UPDATE, not a read-then-write — the Neon HTTP driver has no interactive
 * transactions). A mismatch throws `stale_menu` carrying the current server
 * `updatedAt`, so two editing browsers converge through an explicit reload
 * instead of silently overwriting each other.
 *
 * Every direction crosses the canonical Zod schema: documents are validated
 * on write and re-validated on read, so a malformed row fails loudly rather
 * than rendering garbage (AGENTS.md — one canonical menu schema).
 */

export type MenuRepoErrorCode = "not_found" | "forbidden" | "stale" | "exists" | "invalid_doc";

export class MenuRepoError extends Error {
  readonly code: MenuRepoErrorCode;
  /** For `stale`: the row's current server updatedAt (ISO 8601). */
  readonly currentUpdatedAt: string | null;

  constructor(code: MenuRepoErrorCode, message: string, currentUpdatedAt: string | null = null) {
    super(message);
    this.name = "MenuRepoError";
    this.code = code;
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

export interface ServerMenuSummary {
  id: string;
  restaurantId: string;
  restaurantName: string;
  title: string;
  currency: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerMenu extends ServerMenuSummary {
  doc: MenuDocument;
}

/** One joined row: the menu plus the caller's membership role on its restaurant. */
type MenuWithRole = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  title: string;
  currency: string | null;
  doc: unknown;
  createdAt: Date;
  updatedAt: Date;
  role: RestaurantRole;
};

const menuJoin = (db: TenancyDb) =>
  db
    .select({
      id: menu.id,
      restaurantId: menu.restaurantId,
      restaurantName: restaurant.name,
      title: menu.title,
      currency: menu.currency,
      doc: menu.doc,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      role: restaurantMembership.role,
    })
    .from(menu)
    .innerJoin(restaurant, eq(menu.restaurantId, restaurant.id))
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, restaurant.id));

function iso(value: Date): string {
  return value.toISOString();
}

function toSummary(row: Omit<MenuWithRole, "doc" | "role">): ServerMenuSummary {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    title: row.title,
    currency: row.currency,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function parseDoc(row: Pick<MenuWithRole, "id" | "doc">): MenuDocument {
  const parsed = menuDocumentSchema.safeParse(row.doc);
  if (!parsed.success) {
    // Honest failure: a stored row that no longer matches the canonical
    // schema is a server bug, not something to silently repair.
    throw new Error(`stored menu ${row.id} failed canonical schema validation`);
  }
  return parsed.data;
}

function toMenu(row: MenuWithRole): ServerMenu {
  return { ...toSummary(row), doc: parseDoc(row) };
}

/** Validate + stamp a document for persistence. Server clock owns updatedAt. */
function prepareDoc(input: MenuDocument): { doc: MenuDocument; updatedAt: Date } {
  const parsed = menuDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new MenuRepoError(
      "invalid_doc",
      parsed.error.issues[0]?.message ?? "The menu document is not valid."
    );
  }
  const updatedAt = new Date();
  return { doc: { ...parsed.data, updatedAt: iso(updatedAt) }, updatedAt };
}

function stampRowValues(doc: MenuDocument, updatedAt: Date) {
  return { title: doc.title, currency: doc.currency, doc, updatedAt };
}

/** All menus across the restaurants the user belongs to, most recent first. */
export async function listMenusForUser(db: TenancyDb, userId: string): Promise<ServerMenuSummary[]> {
  const rows = await menuJoin(db)
    .where(eq(restaurantMembership.userId, userId))
    .orderBy(desc(menu.updatedAt), asc(menu.id));
  return rows.map((row) => toSummary(row));
}

/**
 * Create a menu (with its client-generated id, preserved for account
 * import) inside a restaurant the caller owns.
 */
export async function createMenuForUser(
  db: TenancyDb,
  userId: string,
  restaurantId: string,
  input: MenuDocument
): Promise<ServerMenu> {
  const role = await roleOf(db, userId, restaurantId);
  if (role === null) {
    // No membership: the restaurant must not be distinguishable from a
    // nonexistent one.
    throw new MenuRepoError("not_found", "That restaurant does not exist.");
  }
  if (role !== "owner") {
    throw new MenuRepoError("forbidden", "Only the restaurant owner can add menus.");
  }
  const { doc, updatedAt } = prepareDoc(input);
  if (doc.id !== input.id) {
    throw new MenuRepoError("invalid_doc", "Menu id mismatch.");
  }
  try {
    await db.insert(menu).values({
      id: doc.id,
      restaurantId,
      ...stampRowValues(doc, updatedAt),
      createdAt: updatedAt,
    });
  } catch (error) {
    if (await menuExists(db, doc.id)) {
      throw new MenuRepoError("exists", "A menu with this id already exists in your account.");
    }
    throw error;
  }
  const created = await menuJoin(db).where(
    and(eq(menu.id, doc.id), eq(restaurantMembership.userId, userId))
  );
  const row = created[0];
  if (!row) throw new Error("menu creation did not produce a readable row");
  return toMenu(row);
}

/** One menu, readable by any member (owner or staff) of its restaurant. */
export async function getMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<ServerMenu> {
  const rows = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const row = rows[0];
  if (!row) throw new MenuRepoError("not_found", "That menu does not exist.");
  return toMenu(row);
}

/**
 * Replace a menu's document, but only if it has not changed on the server
 * since the caller last read it. `expectedUpdatedAt` must be an ISO string
 * previously returned by this API; anything else is a client bug and is
 * rejected as `invalid_doc`.
 */
export async function updateMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  input: MenuDocument,
  expectedUpdatedAt: string
): Promise<ServerMenu> {
  const rows = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const existing = rows[0];
  if (!existing) throw new MenuRepoError("not_found", "That menu does not exist.");
  if (existing.role !== "owner") {
    throw new MenuRepoError("forbidden", "Only the restaurant owner can change menus.");
  }

  const expected = new Date(expectedUpdatedAt);
  if (Number.isNaN(expected.getTime())) {
    throw new MenuRepoError("invalid_doc", "expectedUpdatedAt must be an ISO 8601 timestamp.");
  }
  if (input.id !== menuId) {
    throw new MenuRepoError("invalid_doc", "Menu id mismatch.");
  }
  const { doc, updatedAt } = prepareDoc(input);

  // The conflict check and the write are one statement: no transaction is
  // needed even on the Neon HTTP driver, and a concurrent write between
  // our read and this UPDATE simply loses the race (0 rows) instead of
  // being overwritten.
  const updated = await db
    .update(menu)
    .set(stampRowValues(doc, updatedAt))
    .where(and(eq(menu.id, menuId), eq(menu.updatedAt, expected)))
    .returning({ id: menu.id });

  if (updated.length === 0) {
    const current = await db
      .select({ updatedAt: menu.updatedAt })
      .from(menu)
      .where(eq(menu.id, menuId));
    const row = current[0];
    if (!row) throw new MenuRepoError("not_found", "That menu does not exist.");
    throw new MenuRepoError(
      "stale",
      "This menu was changed elsewhere since you last loaded it.",
      iso(row.updatedAt)
    );
  }

  const fresh = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const freshRow = fresh[0];
  if (!freshRow) throw new Error("menu update did not produce a readable row");
  return toMenu(freshRow);
}

/** Owner-only delete. False when the menu doesn't exist (or isn't the caller's). */
export async function deleteMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<boolean> {
  const rows = await menuJoin(db).where(
    and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId))
  );
  const existing = rows[0];
  if (!existing) return false;
  if (existing.role !== "owner") {
    throw new MenuRepoError("forbidden", "Only the restaurant owner can delete menus.");
  }
  const deleted = await db.delete(menu).where(eq(menu.id, menuId)).returning({ id: menu.id });
  return deleted.length > 0;
}

async function menuExists(db: TenancyDb, menuId: string): Promise<boolean> {
  const rows = await db.select({ id: menu.id }).from(menu).where(eq(menu.id, menuId));
  return rows.length > 0;
}

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
