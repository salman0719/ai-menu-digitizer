import { and, eq, isNotNull, sql } from "drizzle-orm";

import {
  menu,
  menuRevision,
  publishedMenu,
  restaurant,
  restaurantMembership,
} from "@/lib/db/schema";
import type { RestaurantRole } from "@/lib/db/schema";
import type { TenancyDb } from "@/features/tenancy/repo";
import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";
import {
  isPreviewLayoutId,
  isPreviewThemeId,
  type PreviewLayoutId,
  type PreviewThemeId,
} from "@/features/menu/preview-themes";

import {
  MENU_SLUG_PATTERN,
  publicationPath,
  publishBodySchema,
  type PublicationStatus,
} from "./schema";
import { slugCandidates, slugifyMenuTitle } from "./slug";

/**
 * Server repository for published menus (Step 9 — one-click publish).
 *
 * Tenancy and roles mirror the menu repo exactly (PHASE-2.md §3.1): any
 * member may read a menu's publication status, only the owner may publish,
 * change the address, or unpublish. A menu that isn't the caller's is
 * reported as `not_found`, never `forbidden`, so ids cannot be probed.
 *
 * The live page is always a stored snapshot: publishing copies the validated
 * document into `menu_revision` and moves `published_menu.live_revision_id`.
 * Editing the menu afterwards therefore cannot change the public page, and
 * `hasUnpublishedChanges` is a timestamp comparison — the live revision's
 * `sourceUpdatedAt` against the menu row's `updated_at` — not a re-diff of
 * two documents.
 *
 * Unpublishing keeps the row (and its slug) reserved with `published_at`
 * cleared, so the address stays with the same café and the page stops
 * serving. Nothing here deletes history.
 */

export type PublicationRepoErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid"
  | "slug_taken"
  | "not_published";

export class PublicationRepoError extends Error {
  readonly code: PublicationRepoErrorCode;

  constructor(code: PublicationRepoErrorCode, message: string) {
    super(message);
    this.name = "PublicationRepoError";
    this.code = code;
  }
}

export interface PublishInput {
  theme: PreviewThemeId;
  layout: PreviewLayoutId;
  /** Omit to keep the current slug (or derive one from the title). */
  slug?: string;
}

/** A live published page, prepared for the public route and ordering. */
export interface PublishedMenuPage {
  slug: string;
  /** The menu and tenant this snapshot belongs to (orders are scoped by them). */
  menuId: string;
  restaurantId: string;
  restaurantName: string;
  doc: MenuDocument;
  theme: PreviewThemeId;
  layout: PreviewLayoutId;
  publishedAt: string;
  viewCount: number;
}

interface MenuWithRole {
  id: string;
  restaurantId: string;
  doc: unknown;
  updatedAt: Date;
  role: RestaurantRole;
}

async function loadMenuWithRole(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<MenuWithRole | null> {
  const rows = await db
    .select({
      id: menu.id,
      restaurantId: menu.restaurantId,
      doc: menu.doc,
      updatedAt: menu.updatedAt,
      role: restaurantMembership.role,
    })
    .from(menu)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, menu.restaurantId))
    .where(and(eq(menu.id, menuId), eq(restaurantMembership.userId, userId)));
  return rows[0] ?? null;
}

/**
 * Read a menu's publication state without a user scope. Callers must have
 * already established membership (the exported functions below do).
 */
async function readStatus(db: TenancyDb, menuId: string): Promise<PublicationStatus | null> {
  const rows = await db
    .select({
      slug: publishedMenu.slug,
      publishedAt: publishedMenu.publishedAt,
      liveRevisionId: publishedMenu.liveRevisionId,
      viewCount: publishedMenu.viewCount,
      restaurantId: publishedMenu.restaurantId,
      menuUpdatedAt: menu.updatedAt,
      theme: menuRevision.theme,
      layout: menuRevision.layout,
      sourceUpdatedAt: menuRevision.sourceUpdatedAt,
    })
    .from(publishedMenu)
    .innerJoin(menu, eq(menu.id, publishedMenu.menuId))
    .leftJoin(menuRevision, eq(menuRevision.id, publishedMenu.liveRevisionId))
    .where(eq(publishedMenu.menuId, menuId));

  const row = rows[0];
  if (!row) return null;

  const isLive = row.publishedAt !== null && row.liveRevisionId !== null;
  const sourceUpdatedAt = isLive && row.sourceUpdatedAt ? row.sourceUpdatedAt : null;
  return {
    menuId,
    restaurantId: row.restaurantId,
    slug: row.slug,
    urlPath: publicationPath(row.slug),
    isLive,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    liveRevisionId: isLive ? row.liveRevisionId : null,
    viewCount: row.viewCount,
    theme: isPreviewThemeId(row.theme) ? row.theme : null,
    layout: isPreviewLayoutId(row.layout) ? row.layout : null,
    sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
    // Only meaningful while live: a reserved-but-unpublished menu has
    // nothing public to be out of date with.
    hasUnpublishedChanges:
      sourceUpdatedAt !== null && sourceUpdatedAt.getTime() !== row.menuUpdatedAt.getTime(),
  };
}

/** Any member can read the publication status; null = never published. */
export async function getPublicationStatus(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<PublicationStatus | null> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  return readStatus(db, menuId);
}

/** True when the slug already belongs to a different menu. */
async function slugTakenByAnother(
  db: TenancyDb,
  slug: string,
  menuId: string
): Promise<boolean> {
  const rows = await db
    .select({ menuId: publishedMenu.menuId })
    .from(publishedMenu)
    .where(eq(publishedMenu.slug, slug));
  return rows.some((row) => row.menuId !== menuId);
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

/**
 * Reserve a new publication row, deriving a free slug from `base`. Races are
 * resolved by retrying the next candidate on a unique violation instead of
 * failing the publish.
 */
async function reservePublication(
  db: TenancyDb,
  menuId: string,
  restaurantId: string,
  base: string
): Promise<{ id: string; slug: string }> {
  for (const candidate of slugCandidates(base)) {
    try {
      const inserted = await db
        .insert(publishedMenu)
        .values({ menuId, restaurantId, slug: candidate })
        .returning({ id: publishedMenu.id, slug: publishedMenu.slug });
      return inserted[0];
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new PublicationRepoError(
    "slug_taken",
    "Could not find a free link for this menu. Try a different name."
  );
}

async function changeSlug(
  db: TenancyDb,
  menuId: string,
  slug: string
): Promise<void> {
  if (await slugTakenByAnother(db, slug, menuId)) {
    throw new PublicationRepoError("slug_taken", "That link is already used by another menu.");
  }
  try {
    await db.update(publishedMenu).set({ slug }).where(eq(publishedMenu.menuId, menuId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PublicationRepoError("slug_taken", "That link was just taken. Try another.");
    }
    throw error;
  }
}

/**
 * Publish the menu's current document (or publish changes): store a new
 * revision snapshot, then point the public page at it. Re-publishing keeps
 * the existing slug and view count.
 */
export async function publishMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  input: PublishInput
): Promise<PublicationStatus> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  if (menuRow.role !== "owner") {
    throw new PublicationRepoError("forbidden", "Only the restaurant owner can publish this menu.");
  }

  const body = publishBodySchema.safeParse(input);
  if (!body.success) {
    throw new PublicationRepoError(
      "invalid",
      body.error.issues[0]?.message ?? "The publish request is not valid."
    );
  }
  const parsedDoc = menuDocumentSchema.safeParse(menuRow.doc);
  if (!parsedDoc.success) {
    // A stored row that no longer matches the canonical schema is a server
    // bug — refusing beats publishing garbage.
    throw new PublicationRepoError("invalid", "This menu is not valid and cannot be published.");
  }

  // Resolve the address before touching the live pointer.
  const existing = await db
    .select({ id: publishedMenu.id, slug: publishedMenu.slug })
    .from(publishedMenu)
    .where(eq(publishedMenu.menuId, menuId));
  let publication = existing[0];
  if (!publication) {
    if (body.data.slug) {
      if (await slugTakenByAnother(db, body.data.slug, menuId)) {
        throw new PublicationRepoError("slug_taken", "That link is already used by another menu.");
      }
      publication = await reservePublication(db, menuId, menuRow.restaurantId, body.data.slug);
    } else {
      publication = await reservePublication(
        db,
        menuId,
        menuRow.restaurantId,
        slugifyMenuTitle(parsedDoc.data.title)
      );
    }
  } else if (body.data.slug && body.data.slug !== publication.slug) {
    await changeSlug(db, menuId, body.data.slug);
  }

  const revisionId = crypto.randomUUID();
  await db.insert(menuRevision).values({
    id: revisionId,
    menuId,
    restaurantId: menuRow.restaurantId,
    doc: parsedDoc.data,
    theme: body.data.theme,
    layout: body.data.layout,
    sourceUpdatedAt: menuRow.updatedAt,
  });

  // Move the live pointer only after the snapshot exists, so a failure never
  // leaves the public page pointing at a missing revision.
  const now = new Date();
  await db
    .update(publishedMenu)
    .set({ liveRevisionId: revisionId, publishedAt: now, updatedAt: now })
    .where(eq(publishedMenu.id, publication.id));

  const status = await readStatus(db, menuId);
  if (!status) throw new Error("publishing did not produce a readable publication row");
  return status;
}

/** Stop serving the page; the slug stays reserved for the same menu. */
export async function unpublishMenuForUser(
  db: TenancyDb,
  userId: string,
  menuId: string
): Promise<PublicationStatus> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  if (menuRow.role !== "owner") {
    throw new PublicationRepoError("forbidden", "Only the restaurant owner can unpublish this menu.");
  }
  const existing = await db
    .select({ id: publishedMenu.id })
    .from(publishedMenu)
    .where(eq(publishedMenu.menuId, menuId));
  if (existing.length === 0) {
    throw new PublicationRepoError("not_published", "This menu has not been published.");
  }
  await db
    .update(publishedMenu)
    .set({ publishedAt: null, liveRevisionId: null, updatedAt: new Date() })
    .where(eq(publishedMenu.menuId, menuId));

  const status = await readStatus(db, menuId);
  if (!status) throw new Error("unpublishing did not produce a readable publication row");
  return status;
}

/** Change the public address of an already-published menu (owner only). */
export async function changeMenuSlugForUser(
  db: TenancyDb,
  userId: string,
  menuId: string,
  slug: string
): Promise<PublicationStatus> {
  const menuRow = await loadMenuWithRole(db, userId, menuId);
  if (!menuRow) throw new PublicationRepoError("not_found", "That menu does not exist.");
  if (menuRow.role !== "owner") {
    throw new PublicationRepoError("forbidden", "Only the restaurant owner can change the link.");
  }
  if (!MENU_SLUG_PATTERN.test(slug)) {
    throw new PublicationRepoError("invalid", "Use lowercase letters, numbers, and single hyphens.");
  }
  const existing = await db
    .select({ slug: publishedMenu.slug })
    .from(publishedMenu)
    .where(eq(publishedMenu.menuId, menuId));
  if (existing.length === 0) {
    throw new PublicationRepoError("not_published", "Publish this menu before naming its link.");
  }
  if (existing[0].slug !== slug) await changeSlug(db, menuId, slug);

  const status = await readStatus(db, menuId);
  if (!status) throw new Error("changing the slug did not produce a readable publication row");
  return status;
}

/**
 * The public read path: a live page by slug, with the snapshot's document
 * re-validated against the canonical schema. Null means "not found or not
 * serving" — callers must render a 404, never a partial page.
 */
export async function getPublishedMenuBySlug(
  db: TenancyDb,
  slug: string
): Promise<PublishedMenuPage | null> {
  const rows = await db
    .select({
      slug: publishedMenu.slug,
      menuId: publishedMenu.menuId,
      restaurantId: publishedMenu.restaurantId,
      publishedAt: publishedMenu.publishedAt,
      viewCount: publishedMenu.viewCount,
      restaurantName: restaurant.name,
      doc: menuRevision.doc,
      theme: menuRevision.theme,
      layout: menuRevision.layout,
    })
    .from(publishedMenu)
    .innerJoin(menu, eq(menu.id, publishedMenu.menuId))
    .innerJoin(menuRevision, eq(menuRevision.id, publishedMenu.liveRevisionId))
    .innerJoin(restaurant, eq(restaurant.id, publishedMenu.restaurantId))
    .where(and(eq(publishedMenu.slug, slug), isNotNull(publishedMenu.publishedAt)));

  const row = rows[0];
  if (!row || row.publishedAt === null) return null;

  const parsedDoc = menuDocumentSchema.safeParse(row.doc);
  if (!parsedDoc.success) {
    throw new Error(`published menu ${slug} failed canonical schema validation`);
  }
  if (!isPreviewThemeId(row.theme) || !isPreviewLayoutId(row.layout)) {
    throw new Error(`published menu ${slug} has an unknown theme or layout`);
  }

  return {
    slug: row.slug,
    menuId: row.menuId,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    doc: parsedDoc.data,
    theme: row.theme,
    layout: row.layout,
    publishedAt: row.publishedAt.toISOString(),
    viewCount: row.viewCount,
  };
}

/**
 * Count one page view. Cookie-free and server-side: a single atomic
 * increment, only while the page is live. Returns false when nothing was
 * counted (unknown slug or unpublished), so the beacon stays honest.
 */
export async function recordPublishedView(db: TenancyDb, slug: string): Promise<boolean> {
  const updated = await db
    .update(publishedMenu)
    .set({ viewCount: sql`${publishedMenu.viewCount} + 1` })
    .where(and(eq(publishedMenu.slug, slug), isNotNull(publishedMenu.publishedAt)))
    .returning({ id: publishedMenu.id });
  return updated.length > 0;
}
