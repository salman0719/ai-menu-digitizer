import { describe, expect, it } from "vitest";

import { appendExtractionToDocument, extractedMenuToDocument } from "../src/features/menu/convert";
import { findDuplicateGroups } from "../src/features/menu/duplicates";
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

describe("appendExtractionToDocument", () => {
  const base = () =>
    extractedMenuToDocument({
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
          ],
        },
      ],
    });

  const extraPage = () => ({
    title: "Café — page 2",
    currency: "EUR",
    categories: [
      {
        name: "Desserts",
        items: [
          {
            name: "Tiramisu",
            description: null,
            price: 5,
            currency: null,
            variants: [],
            options: [],
            dietaryLabels: [],
            available: null,
            reviewNotes: [],
          },
          {
            name: "Espresso",
            description: null,
            price: null,
            currency: null,
            variants: [],
            options: [],
            dietaryLabels: [],
            available: null,
            reviewNotes: ["faint print"],
          },
        ],
      },
    ],
  });

  it("appends categories without touching the existing document", () => {
    const doc = base();
    const before = JSON.parse(JSON.stringify(doc.categories[0]));
    const { doc: merged, addedItems, addedCategories } = appendExtractionToDocument(
      doc,
      extraPage()
    );
    expect(() => menuDocumentSchema.parse(merged)).not.toThrow();
    // Existing content is byte-identical; the menu title stands.
    expect(merged.categories[0]).toEqual(before);
    expect(merged.title).toBe("Café");
    // New categories continue the sort order with fresh ids.
    expect(merged.categories.map((c) => c.name)).toEqual(["Drinks", "Desserts"]);
    expect(merged.categories.map((c) => c.sortOrder)).toEqual([0, 1]);
    expect(merged.categories[1].id).not.toBe(doc.categories[0].id);
    expect(addedItems).toBe(2);
    expect(addedCategories).toBe(1);
    // The document keeps its own currency; the extra page's is ignored.
    expect(merged.currency).toBe("USD");
  });

  it("adopts the extraction currency only when the document has none", () => {
    const doc = { ...base(), currency: null };
    const { doc: merged } = appendExtractionToDocument(doc, extraPage());
    expect(merged.currency).toBe("EUR");
  });

  it("leaves repeats for the duplicate review instead of merging them away", () => {
    const { doc: merged } = appendExtractionToDocument(base(), extraPage());
    const groups = findDuplicateGroups(merged);
    expect(groups.map((g) => g.key)).toContain("espresso");
    expect(groups.find((g) => g.key === "espresso")?.occurrences).toHaveLength(2);
  });

  it("handles an empty later extraction as a no-op with zero counts", () => {
    const doc = base();
    const { doc: merged, addedItems, addedCategories } = appendExtractionToDocument(doc, {
      title: null,
      currency: null,
      categories: [],
    });
    expect(merged.categories).toEqual(doc.categories);
    expect(addedItems).toBe(0);
    expect(addedCategories).toBe(0);
    expect(() => menuDocumentSchema.parse(merged)).not.toThrow();
  });
});
