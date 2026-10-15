/**
 * Convert a validated AI extraction into a canonical `MenuDocument`.
 * Assigns fresh stable IDs and dense sort orders; preserves every honest
 * null, dietary label, and review note. Type-only import of the AI shape —
 * erased at compile time, so no server code enters client bundles.
 */

import type { ExtractedMenu } from "@/lib/ai/extraction-schema";

import { generateId, nowIso } from "./menu-utils";
import { SCHEMA_VERSION, type MenuDocument } from "./schema";

export interface ExtractionSource {
  provider?: string;
  model?: string;
  originalFileName?: string;
}

export function extractedMenuToDocument(
  extracted: ExtractedMenu,
  source?: ExtractionSource
): MenuDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: generateId(),
    title: extracted.title?.trim() ? extracted.title.trim() : "Untitled menu",
    currency: extracted.currency ?? null,
    categories: extracted.categories.map((category, categoryIndex) => ({
      id: generateId(),
      name: category.name,
      sortOrder: categoryIndex,
      items: category.items.map((item, itemIndex) => ({
        id: generateId(),
        name: item.name,
        description: item.description ?? null,
        price: item.price ?? null,
        currency: item.currency ?? extracted.currency ?? null,
        sortOrder: itemIndex,
        available: item.available ?? null,
        dietaryLabels: [...item.dietaryLabels],
        variants: item.variants.map((v) => ({ name: v.name, price: v.price ?? null })),
        options: item.options.map((o) => ({
          name: o.name,
          choices: o.choices.map((c) => ({ name: c.name, priceDelta: c.priceDelta ?? null })),
        })),
        reviewNotes: [...item.reviewNotes],
      })),
    })),
    source: {
      ...(source?.originalFileName ? { originalFileName: source.originalFileName } : {}),
      extractedAt: nowIso(),
      ...(source?.provider ? { provider: source.provider } : {}),
      ...(source?.model ? { model: source.model } : {}),
    },
    updatedAt: nowIso(),
  };
}
