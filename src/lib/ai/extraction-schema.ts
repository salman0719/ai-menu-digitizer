/**
 * Schema for the raw AI extraction result. Server-only.
 *
 * This is intentionally NOT the canonical menu schema: the model returns
 * no stable IDs and no sort orders. The client converts a validated
 * `ExtractedMenu` into a `MenuDocument` (assigning IDs/order) in a later step.
 *
 * Nullable fields default to `null` when omitted: the model often drops keys
 * entirely, and omission means the same honest thing as explicit `null`.
 * Wrong types (e.g. a string price) and empty names still fail validation.
 */

import { z } from "zod";

export const extractedVariantSchema = z.object({
  name: z.string().min(1),
  price: z.number().nullable().default(null),
});

export const extractedOptionChoiceSchema = z.object({
  name: z.string().min(1),
  priceDelta: z.number().nullable().default(null),
});

export const extractedOptionSchema = z.object({
  name: z.string().min(1),
  choices: z.array(extractedOptionChoiceSchema).default([]),
});

export const extractedItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  price: z.number().nullable().default(null),
  currency: z.string().min(1).nullable().default(null),
  variants: z.array(extractedVariantSchema).default([]),
  options: z.array(extractedOptionSchema).default([]),
  dietaryLabels: z.array(z.string().min(1)).default([]),
  available: z.boolean().nullable().default(null),
  reviewNotes: z.array(z.string().min(1)).default([]),
});

export const extractedCategorySchema = z.object({
  name: z.string().min(1),
  items: z.array(extractedItemSchema).default([]),
});

export const extractedMenuSchema = z.object({
  title: z.string().nullable().default(null),
  currency: z.string().min(1).nullable().default(null),
  // Empty is valid: a non-menu image yields zero categories and the UI
  // shows an empty state rather than an error.
  categories: z.array(extractedCategorySchema).default([]),
});

export type ExtractedMenu = z.infer<typeof extractedMenuSchema>;
