import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREVIEW_THEME_ID,
  PREVIEW_THEMES,
  PREVIEW_THEME_IDS,
  isPreviewThemeId,
  previewTheme,
} from "../src/features/menu/preview-themes";

describe("preview themes", () => {
  it("exposes a non-empty, uniquely named registry", () => {
    expect(PREVIEW_THEME_IDS.length).toBeGreaterThanOrEqual(3);
    const names = PREVIEW_THEME_IDS.map((id) => PREVIEW_THEMES[id].name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every theme its own surface and typography tokens", () => {
    for (const id of PREVIEW_THEME_IDS) {
      const theme = PREVIEW_THEMES[id];
      expect(theme.id).toBe(id);
      expect(theme.name.length).toBeGreaterThan(0);
      for (const token of [
        theme.page,
        theme.font,
        theme.title,
        theme.eyebrow,
        theme.sectionHeading,
        theme.itemName,
        theme.description,
        theme.price,
        theme.leader,
        theme.variantName,
        theme.variantPrice,
        theme.badge,
        theme.sectionRule,
      ]) {
        expect(token.trim().length).toBeGreaterThan(0);
      }
    }
    // Surfaces must differ, otherwise themes are cosmetic duplicates.
    const surfaces = new Set(PREVIEW_THEME_IDS.map((id) => PREVIEW_THEMES[id].page));
    expect(surfaces.size).toBe(PREVIEW_THEME_IDS.length);
  });

  it("falls back to the default for unknown ids", () => {
    expect(previewTheme(null).id).toBe(DEFAULT_PREVIEW_THEME_ID);
    expect(previewTheme(undefined).id).toBe(DEFAULT_PREVIEW_THEME_ID);
    expect(isPreviewThemeId("nope")).toBe(false);
    expect(isPreviewThemeId(PREVIEW_THEME_IDS[0])).toBe(true);
  });
});
