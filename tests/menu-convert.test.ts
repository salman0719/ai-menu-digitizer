import { describe, expect, it } from "vitest";

import { extractedMenuToDocument } from "../src/features/menu/convert";
import { menuDocumentSchema } from "../src/features/menu/schema";

describe("extractedMenuToDocument", () => {
  it("assigns ids and dense orders while preserving honest nulls", () => {
    const doc = extractedMenuToDocument(
      {
        title: "Café",
        currency: "USD",
        categories: [
          {
            name: "Drinks",
            items: [
              {
                name: "Espresso",
                description: null,
                price: 3,
                currency: null,
                variants: [],
                options: [],
                dietaryLabels: [],
                available: null,
                reviewNotes: [],
              },
              {
                name: "Mystery",
                description: null,
                price: null,
                currency: null,
                variants: [],
                options: [],
                dietaryLabels: [],
                available: null,
                reviewNotes: ["illegible"],
              },
            ],
          },
        ],
      },
      { provider: "gemini", model: "test-model", originalFileName: "menu.jpg" }
    );
    expect(() => menuDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.categories[0].sortOrder).toBe(0);
    expect(doc.categories[0].items.map((i) => i.sortOrder)).toEqual([0, 1]);
    const ids = new Set([
      doc.id,
      doc.categories[0].id,
      ...doc.categories[0].items.map((i) => i.id),
    ]);
    expect(ids.size).toBe(4);
    expect(doc.categories[0].items[1].price).toBeNull();
    expect(doc.categories[0].items[1].reviewNotes).toEqual(["illegible"]);
    // Item inherits document currency when the AI gave none.
    expect(doc.categories[0].items[0].currency).toBe("USD");
    expect(doc.source).toMatchObject({ provider: "gemini", originalFileName: "menu.jpg" });
  });

  it("falls back to a default title for empty extractions", () => {
    const doc = extractedMenuToDocument({ title: null, currency: null, categories: [] });
    expect(doc.title).toBe("Untitled menu");
    expect(doc.categories).toEqual([]);
    expect(() => menuDocumentSchema.parse(doc)).not.toThrow();
  });
});
