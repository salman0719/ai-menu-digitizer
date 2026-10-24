import { z } from "zod";

import { menuDocumentSchema } from "@/features/menu/schema";

import {
  menuSlugSchema,
  previewLayoutIdSchema,
  previewThemeIdSchema,
  publicationStatusSchema,
} from "./schema";

/**
 * The publish wizard's server contract (R1).
 *
 * One request is enough to go from a browser-only draft to a live link: the
 * server creates the restaurant only when the owner has none, copies the
 * draft into the account when it is not there yet, and publishes the
 * snapshot. The client never supplies ownership ids that are trusted — they
 * are only *requested* targets, checked against the session's memberships.
 *
 * `doc` is optional because an account menu is published from its stored
 * revision, never from a client copy: that keeps the route idempotent on a
 * retry (the retry sees the menu already created) and prevents a stale local
 * copy from silently overwriting the account.
 */
export const publishSetupBodySchema = z.object({
  /** Required only when the menu does not exist in the account yet. */
  doc: menuDocumentSchema.optional(),
  /** An existing restaurant the caller owns. Takes precedence over a name. */
  restaurantId: z.string().trim().min(1).optional(),
  /** Used only to create a restaurant when the caller owns none. */
  restaurantName: z.string().trim().min(1).max(120).optional(),
  theme: previewThemeIdSchema,
  layout: previewLayoutIdSchema,
  /** Optional first-publish address; omitted means derive it from the title. */
  slug: menuSlugSchema.optional(),
});

export type PublishSetupInput = z.infer<typeof publishSetupBodySchema>;

export const publishSetupResultSchema = z.object({
  publication: publicationStatusSchema,
  restaurant: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  /** What this request added, so the UI can celebrate without guessing. */
  created: z.object({
    restaurant: z.boolean(),
    menu: z.boolean(),
  }),
});

export type PublishSetupResult = z.infer<typeof publishSetupResultSchema>;
