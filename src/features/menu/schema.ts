/**
 * Canonical menu schema — the single source of truth for AI output,
 * UI state, stored records, and imported files (see PLAN.md §6).
 *
 * Do NOT define competing menu types elsewhere; import from here
 * (or from `./types` for derived helper types).
 *
 * Honesty rules (PLAN.md §5B):
 * - Missing prices, descriptions, dietary labels, or ingredients are
 *   `null`/empty — never invented.
 * - Uncertainty is recorded in `reviewNotes`, never silently resolved.
 * - Stable app-generated IDs (`generateId()` in `./menu-utils`), never
 *   names, identify categories and items.
 *
 * Conventions:
 * - `sortOrder` is a dense 0-based position within its parent array.
 *   Helpers in `./menu-utils` renumber after every edit.
 * - Timestamps are ISO 8601 strings (`new Date().toISOString()`).
 * - `currency` is the literal code/symbol as seen on the menu
 *   (e.g. "USD", "$", "€") or `null` when not shown.
 */

import { z } from "zod";

/** Current version of the stored menu document format. Bump on breaking changes. */
export const SCHEMA_VERSION = 1 as const;

export const menuVariantSchema = z.object({
  name: z.string().min(1),
  price: z.number().nullable(),
});

export const menuOptionChoiceSchema = z.object({
  name: z.string().min(1),
  priceDelta: z.number().nullable(),
});

export const menuOptionSchema = z.object({
  name: z.string().min(1),
  choices: z.array(menuOptionChoiceSchema).default([]),
});

export const menuItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().min(1).nullable(),
  sortOrder: z.number().int().nonnegative(),
  available: z.boolean().nullable(),
  dietaryLabels: z.array(z.string().min(1)).default([]),
  variants: z.array(menuVariantSchema).default([]),
  options: z.array(menuOptionSchema).default([]),
  reviewNotes: z.array(z.string().min(1)).default([]),
});

export const menuCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  items: z.array(menuItemSchema).default([]),
});

export const menuSourceSchema = z.object({
  originalFileName: z.string().min(1).optional(),
  extractedAt: z.string().min(1).optional(),
  /** e.g. "gemini" for live extraction, "demo" for sample data. */
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export const menuDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  currency: z.string().min(1).nullable(),
  categories: z.array(menuCategorySchema).default([]),
  source: menuSourceSchema.optional(),
  updatedAt: z.string().min(1),
});

export type MenuVariant = z.infer<typeof menuVariantSchema>;
export type MenuOptionChoice = z.infer<typeof menuOptionChoiceSchema>;
export type MenuOption = z.infer<typeof menuOptionSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MenuCategory = z.infer<typeof menuCategorySchema>;
export type MenuSource = z.infer<typeof menuSourceSchema>;
export type MenuDocument = z.infer<typeof menuDocumentSchema>;
