import { describe, expect, it } from "vitest";

import { extractedMenuSchema } from "../src/lib/ai/extraction-schema";
import { buildExtractionPrompt, buildRepairPrompt } from "../src/lib/ai/prompts";

const validPayload = {
  title: "Sunny Side Café",
  currency: "USD",
  categories: [
    {
      name: "Coffee",
      items: [
        {
          name: "Espresso",
          description: null,
          price: 3.0,
          currency: null,
          variants: [{ name: "Double", price: 3.0 }],
          options: [],
          dietaryLabels: [],
          available: null,
          reviewNotes: [],
        },
      ],
    },
  ],
};

describe("extractedMenuSchema", () => {
  it("accepts a complete extraction payload", () => {
    const parsed = extractedMenuSchema.parse(validPayload);
    expect(parsed.categories).toHaveLength(1);
    expect(parsed.categories[0].items[0].price).toBe(3.0);
  });

  it("fills defaults and accepts honest nulls", () => {
    const parsed = extractedMenuSchema.parse({
      title: null,
      currency: null,
      categories: [{ name: "Menu", items: [{ name: "Special", price: null }] }],
    });
    const item = parsed.categories[0].items[0];
    expect(item.description).toBeNull();
    expect(item.available).toBeNull();
    expect(item.dietaryLabels).toEqual([]);
    expect(item.reviewNotes).toEqual([]);
  });

  it("accepts an empty menu (non-menu image)", () => {
    const parsed = extractedMenuSchema.parse({ title: null, currency: null, categories: [] });
    expect(parsed.categories).toEqual([]);
  });

  it("rejects string prices and empty names without coercing", () => {
    expect(
      extractedMenuSchema.safeParse({
        ...validPayload,
        categories: [
          { name: "Coffee", items: [{ ...validPayload.categories[0].items[0], price: "$3.00" }] },
        ],
      }).success
    ).toBe(false);

    expect(
      extractedMenuSchema.safeParse({
        title: "X",
        currency: null,
        categories: [{ name: "Coffee", items: [{ name: "", price: null }] }],
      }).success
    ).toBe(false);
  });
});

describe("extraction prompts", () => {
  it("directs JSON-only output with honesty rules", () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain("untrusted content");
    expect(prompt).toContain("no Markdown fences");
    expect(prompt).toContain("null");
    expect(prompt).toContain("reviewNotes");
    expect(prompt).toContain("Never invent");
  });

  it("repair prompt includes the issues and the previous output", () => {
    const prompt = buildRepairPrompt('{"bad": true}', ["categories: Required"]);
    expect(prompt).toContain("categories: Required");
    expect(prompt).toContain('{"bad": true}');
    expect(prompt).toContain("corrected JSON");
  });

  it("repair prompt truncates very long outputs", () => {
    const prompt = buildRepairPrompt("x".repeat(9000), ["some issue"]);
    expect(prompt.length).toBeLessThan(9000);
    expect(prompt).toContain("[truncated]");
  });
});
