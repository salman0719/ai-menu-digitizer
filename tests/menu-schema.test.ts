import { describe, expect, it } from "vitest";

import { menuDocumentSchema } from "../src/features/menu/schema";
import { createSampleMenuDocument } from "../src/features/menu/sample-menu";

describe("menuDocumentSchema", () => {
  it("accepts the sample menu fixture", () => {
    const parsed = menuDocumentSchema.parse(createSampleMenuDocument());
    expect(parsed.categories).toHaveLength(2);
    expect(parsed.title).toBe("Sunny Side Café");
  });

  it("fills collection defaults for a minimal document", () => {
    const parsed = menuDocumentSchema.parse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Minimal",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [{ id: "c1", name: "Drinks", sortOrder: 0 }],
    });
    expect(parsed.categories[0].items).toEqual([]);
    expect(parsed.categories[0].items).toEqual([]);
  });

  it("accepts honest nulls for unknown values", () => {
    const parsed = menuDocumentSchema.parse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Sparse",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "c1",
          name: "Mains",
          sortOrder: 0,
          items: [
            {
              id: "i1",
              name: "Mystery dish",
              description: null,
              price: null,
              currency: null,
              sortOrder: 0,
              available: null,
            },
          ],
        },
      ],
    });
    const item = parsed.categories[0].items[0];
    expect(item.price).toBeNull();
    expect(item.available).toBeNull();
    expect(item.dietaryLabels).toEqual([]);
    expect(item.reviewNotes).toEqual([]);
  });

  it("rejects invented-looking wrong types instead of coercing them", () => {
    const result = menuDocumentSchema.safeParse({
      schemaVersion: 1,
      id: "menu-1",
      title: "Bad",
      currency: null,
      updatedAt: new Date().toISOString(),
      categories: [
        {
          id: "c1",
          name: "Drinks",
          sortOrder: 0,
          items: [
            {
              id: "i1",
              // Price must be numeric or null — a string like "$12.50"
              // has to be parsed by the caller, not the schema.
              name: "Latte",
              description: null,
              price: "$12.50",
              currency: null,
              sortOrder: 0,
              available: null,
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty names and wrong schema versions", () => {
    const emptyName = menuDocumentSchema.safeParse({
      schemaVersion: 1,
      id: "menu-1",
      title: "",
      currency: null,
      updatedAt: new Date().toISOString(),
    });
    expect(emptyName.success).toBe(false);

    const wrongVersion = menuDocumentSchema.safeParse({
      schemaVersion: 2,
      id: "menu-1",
      title: "Future",
      currency: null,
      updatedAt: new Date().toISOString(),
    });
    expect(wrongVersion.success).toBe(false);
  });
});
