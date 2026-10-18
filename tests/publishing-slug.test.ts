import { describe, expect, it } from "vitest";

import { SLUG_MAX_LENGTH } from "@/features/publishing/schema";
import { isSlug, slugCandidates, slugifyMenuTitle } from "@/features/publishing/slug";

/**
 * Step 9 — public link generation. The slug is the only part of a published
 * menu people read out loud and type, so these tests pin the rules: readable,
 * lowercase, ASCII, hyphenated, never empty, and never longer than the cap.
 */
describe("slugifyMenuTitle", () => {
  it("lowercases, strips accents, and hyphenates a café name", () => {
    expect(slugifyMenuTitle("Café A")).toBe("cafe-a");
    expect(slugifyMenuTitle("  Chez Nous — Menu du Jour!  ")).toBe("chez-nous-menu-du-jour");
  });

  it("collapses runs of punctuation instead of emitting empty segments", () => {
    expect(slugifyMenuTitle("Rock & Roll  /  Grill")).toBe("rock-roll-grill");
    expect(slugifyMenuTitle("--Already--Slugged--")).toBe("already-slugged");
  });

  it("falls back to a usable slug when the title has no words", () => {
    expect(slugifyMenuTitle("🍜")).toBe("menu");
    expect(slugifyMenuTitle("   ")).toBe("menu");
  });

  it("keeps every derived slug within the length cap with no trailing hyphen", () => {
    const long = slugifyMenuTitle(
      "The Very Long And Deliberately Verbose Neighborhood Breakfast And Brunch Menu"
    );
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(long.endsWith("-")).toBe(false);
    expect(isSlug(long)).toBe(true);
  });

  it("only produces canonical slugs", () => {
    for (const title of ["Café", "a", "Ünïcödé Menu", "50% off!", "C++ & Go"]) {
      expect(isSlug(slugifyMenuTitle(title))).toBe(true);
    }
  });
});

describe("slugCandidates", () => {
  it("offers the base first, then numbered suffixes", () => {
    expect(slugCandidates("my-cafe", 4)).toEqual(["my-cafe", "my-cafe-2", "my-cafe-3", "my-cafe-4"]);
  });

  it("keeps suffixed candidates inside the cap", () => {
    const base = "a".repeat(SLUG_MAX_LENGTH);
    const candidates = slugCandidates(base, 12);
    expect(candidates[0]).toBe(base);
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
      expect(isSlug(candidate)).toBe(true);
    }
    expect(candidates[1].endsWith("-2")).toBe(true);
  });
});

describe("isSlug", () => {
  it("rejects shapes a link should never contain", () => {
    for (const bad of ["My-Cafe", "my cafe", "cafe--a", "-cafe", "cafe-", "", "café"]) {
      expect(isSlug(bad)).toBe(false);
    }
    expect(isSlug("cafe-2")).toBe(true);
  });
});
