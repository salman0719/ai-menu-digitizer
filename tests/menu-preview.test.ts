import { describe, expect, it } from "vitest";

import { formatPreviewPrice, formatPriceDelta } from "../src/features/menu/preview-utils";

describe("formatPreviewPrice", () => {
  it("renders an em dash for an unknown price instead of inventing one", () => {
    expect(formatPreviewPrice(null, "USD", "EUR")).toBe("—");
  });

  it("prefers the item currency over the menu currency", () => {
    expect(formatPreviewPrice(4.5, "GBP", "USD")).toBe("GBP 4.50");
  });

  it("falls back to the menu currency when the item has none", () => {
    expect(formatPreviewPrice(4.5, null, "USD")).toBe("USD 4.50");
  });

  it("renders a bare fixed-point amount when no currency is known", () => {
    expect(formatPreviewPrice(4.5, null, null)).toBe("4.50");
    expect(formatPreviewPrice(0, null, "USD")).toBe("USD 0.00");
  });

  it("rounds to two decimals", () => {
    expect(formatPreviewPrice(12.345, "USD", null)).toBe("USD 12.35");
  });
});

describe("formatPriceDelta", () => {
  it("formats positive deltas with a plus sign", () => {
    expect(formatPriceDelta(1.5)).toBe("+1.50");
  });

  it("formats negative deltas with a minus sign and absolute value", () => {
    expect(formatPriceDelta(-0.5)).toBe("−0.50");
  });

  it("returns an empty string for unknown deltas (nothing invented)", () => {
    expect(formatPriceDelta(null)).toBe("");
  });
});
