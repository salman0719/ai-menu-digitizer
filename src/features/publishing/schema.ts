import { z } from "zod";

import {
  isPreviewLayoutId,
  isPreviewThemeId,
  type PreviewLayoutId,
  type PreviewThemeId,
} from "@/features/menu/preview-themes";

/**
 * Publishing contracts (Step 9), validated at every boundary like the rest
 * of the app. This module stays client-safe (no Drizzle, no server imports):
 * the publish panel runs the same slug rules the API enforces, so a bad slug
 * is caught before a round trip and the server never has to trust the client.
 */

/** Long enough for a café name, short enough to stay shareable. */
export const SLUG_MAX_LENGTH = 48;

/**
 * Public slugs are lowercase ASCII with single hyphens — no spaces, no
 * accents, no leading/trailing or doubled hyphens. Anything else would need
 * percent-encoding in a link people read out loud.
 */
export const MENU_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const menuSlugSchema = z
  .string()
  .trim()
  .min(1, "A link needs at least one character.")
  .max(SLUG_MAX_LENGTH, `Keep the link to ${SLUG_MAX_LENGTH} characters or fewer.`)
  .regex(
    MENU_SLUG_PATTERN,
    "Use lowercase letters, numbers, and single hyphens (e.g. my-cafe)."
  );

/** Theme ids come from the single theme source of truth. */
export const previewThemeIdSchema = z.custom<PreviewThemeId>((value) => isPreviewThemeId(value), {
  message: "Pick one of the available themes.",
});

export const previewLayoutIdSchema = z.custom<PreviewLayoutId>(
  (value) => isPreviewLayoutId(value),
  { message: "Pick one of the available layouts." }
);

/** POST /api/menus/[menuId]/publication — publish (or publish changes). */
export const publishBodySchema = z.object({
  theme: previewThemeIdSchema,
  layout: previewLayoutIdSchema,
  /** Omit to keep the current slug, or derive one from the menu title. */
  slug: menuSlugSchema.optional(),
});

/** PATCH /api/menus/[menuId]/publication — change the address only. */
export const changeSlugBodySchema = z.object({
  slug: menuSlugSchema,
});

/**
 * What the editor needs to know about one menu's publication. `null` means
 * the menu has never been published (no slug reserved yet).
 */
export const publicationStatusSchema = z.object({
  menuId: z.string().min(1),
  restaurantId: z.string().min(1),
  /** The restaurant's public `/r/<slug>` address — always set while published. */
  restaurantSlug: z.string().min(1),
  /** The menu's own address segment inside the restaurant. */
  slug: z.string().min(1),
  /** Path on this site, e.g. /r/my-cafe/m/lunch. */
  urlPath: z.string().min(1),
  /** True only while the page actually serves. */
  isLive: z.boolean(),
  publishedAt: z.string().nullable(),
  liveRevisionId: z.string().nullable(),
  viewCount: z.number().int().nonnegative(),
  theme: previewThemeIdSchema.nullable(),
  layout: previewLayoutIdSchema.nullable(),
  /** The menu revision the live page was published from. */
  sourceUpdatedAt: z.string().nullable(),
  /** Draft edits exist that the public page does not show yet. */
  hasUnpublishedChanges: z.boolean(),
});

export type PublicationStatus = z.infer<typeof publicationStatusSchema>;

/** One published page as served to a visitor (already re-validated). */
export const publishedMenuViewSchema = z.object({
  slug: z.string().min(1),
  restaurantName: z.string(),
  publishedAt: z.string().min(1),
  theme: previewThemeIdSchema,
  layout: previewLayoutIdSchema,
  viewCount: z.number().int().nonnegative(),
});

/**
 * Public page path for a published menu — one place that defines the URL
 * shape: `/r/<restaurant>/<menu>`, i.e. scoped to the café that publishes it.
 * Menu slugs are only unique inside one restaurant, so the restaurant's own
 * `/r/<slug>` address is part of every public link (and of every table card,
 * which already encodes that address).
 */
export function publicationPath(restaurantSlug: string, slug: string): string {
  return `/r/${restaurantSlug}/m/${slug}`;
}
