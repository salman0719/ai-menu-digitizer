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

  it("teaches the model to record per-size prices as variants", () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain("variants");
    expect(prompt).toContain("Small/Medium/Large");
    expect(prompt).toContain("is ONE item");
    expect(prompt).toContain("do not split one item into several items");
    expect(prompt).toContain("column headers");
    expect(prompt).toContain("Never invent a tier label");
    expect(prompt).toContain("spell");
    expect(prompt).toContain("nested list");
    expect(prompt).toContain("Size labels not printed; variant names inferred by column order");
    expect(prompt).toContain("\u21b3 Small (leftmost column): $2.00");
    expect(prompt).toContain("one note per variant");
    expect(prompt).toContain("re-read, round, or re-infer them");
    expect(prompt).toContain("Prefix each with the menu's currency");
    expect(prompt).toContain("each visible section heading still becomes its own");
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

  it("keeps the single-page prompt unchanged by default", () => {
    expect(buildExtractionPrompt()).toBe(buildExtractionPrompt(1));
    expect(buildExtractionPrompt()).not.toContain("do not repeat the heading");
  });

  it("adds merge guidance when the menu spans several pages", () => {
    const prompt = buildExtractionPrompt(3);
    expect(prompt).toContain("untrusted content");
    expect(prompt).toContain("pages 1–3 of the SAME");
    expect(prompt).toContain("do not repeat the heading");
    expect(prompt).toContain("include it only once");
    // Structure rules for the JSON output are still present.
    expect(prompt).toContain("no Markdown fences");
    expect(prompt).toContain("reviewNotes");
  });
});
