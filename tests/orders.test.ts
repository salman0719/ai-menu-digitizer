import { describe, expect, it } from "vitest";

import {
  addLine,
  nextOrderStatus,
  orderCode,
  orderStatusLabel,
  orderTotal,
  setLineQuantity,
  type OrderLine,
} from "../src/features/orders/schema";
import {
  defaultTableLabels,
  sanitizeTableLabels,
  displayTableUrl,
  formatTableLabel,
  normalizeTableLabel,
  parseTableLink,
  tableOrderPath,
  tableOrderUrl,
  publicTableOrderPath,
  publicTableOrderUrl,
} from "../src/features/orders/table-links";

const espresso: OrderLine = {
  menuItemId: "item-espresso",
  name: "Espresso",
  variantName: "Small",
  unitPrice: 2,
  quantity: 2,
};

describe("order totals", () => {
  it("multiplies quantities and rounds to cents", () => {
    const lines: OrderLine[] = [
      { ...espresso },
      { menuItemId: "i2", name: "Croissant", variantName: null, unitPrice: 3.1, quantity: 3 },
    ];
    expect(orderTotal(lines)).toBe(13.3);
  });

  it("returns null when any line is unpriced or the order is empty", () => {
    expect(orderTotal([])).toBeNull();
    expect(orderTotal([{ ...espresso, unitPrice: null }])).toBeNull();
    expect(orderTotal([espresso, { ...espresso, unitPrice: null, name: "Latte" }])).toBeNull();
  });
});

describe("cart lines", () => {
  it("merges the same item and variant, but keeps variants separate", () => {
    const one = addLine([], { ...espresso, quantity: 1 });
    const two = addLine(one, { ...espresso, quantity: 2 });
    expect(two).toHaveLength(1);
    expect(two[0].quantity).toBe(3);

    const large = addLine(two, { ...espresso, variantName: "Large", unitPrice: 2.8 });
    expect(large).toHaveLength(2);
    expect(large[1].variantName).toBe("Large");
  });

  it("rejects non-positive or fractional quantities", () => {
    expect(() => addLine([], { ...espresso, quantity: 0 })).toThrow(/positive/);
    expect(() => addLine([], { ...espresso, quantity: 1.5 })).toThrow(/positive/);
  });

  it("changes quantities and removes lines at zero", () => {
    const lines = [espresso, { ...espresso, menuItemId: "i2", name: "Latte" }];
    expect(setLineQuantity(lines, 0, 5)[0].quantity).toBe(5);
    expect(setLineQuantity(lines, 0, 0)).toHaveLength(1);
    // Out-of-range indexes are ignored rather than throwing.
    expect(setLineQuantity(lines, 9, 3)).toHaveLength(2);
  });
});

describe("order helpers", () => {
  it("derives a short order code and status labels", () => {
    expect(orderCode("id-123456789")).toBe("456789");
    expect(orderCode("")).toBe("ORDER");
    expect(nextOrderStatus("new")).toBe("preparing");
    expect(nextOrderStatus("preparing")).toBe("served");
    expect(nextOrderStatus("served")).toBe("served");
    expect(orderStatusLabel("preparing")).toBe("Preparing");
  });
});

describe("table links", () => {
  it("builds default table labels within sane bounds", () => {
    expect(defaultTableLabels(3)).toEqual(["1", "2", "3"]);
    expect(defaultTableLabels(2, "Table")).toEqual(["Table 1", "Table 2"]);
    expect(defaultTableLabels(0)).toEqual(["1"]);
    expect(defaultTableLabels(999)).toHaveLength(60);
  });

  it("normalizes labels and rejects empty or overlong ones", () => {
    expect(normalizeTableLabel("  Patio   2 ")).toBe("Patio 2");
    expect(normalizeTableLabel("   ")).toBeNull();
    expect(normalizeTableLabel("x".repeat(25))).toBeNull();
    expect(normalizeTableLabel(undefined)).toBeNull();
  });

  it("sanitizes an explicitly typed table list", () => {
    expect(sanitizeTableLabels(["Patio 1", "Patio 2", "Bar"])).toEqual([
      "Patio 1",
      "Patio 2",
      "Bar",
    ]);
    expect(sanitizeTableLabels(["  Patio   1 ", "", "   ", "Bar", "Bar"])).toEqual([
      "Patio 1",
      "Bar",
    ]);
    expect(sanitizeTableLabels([])).toEqual([]);
  });

  it("builds and parses order links", () => {
    const path = tableOrderPath("menu-1", "Patio 2");
    expect(path).toBe("/order?menu=menu-1&table=Patio+2");
    expect(tableOrderUrl("https://example.test/", "menu-1", "3")).toBe(
      "https://example.test/order?menu=menu-1&table=3"
    );

    expect(parseTableLink(new URLSearchParams("menu=abc&table=4"))).toEqual({
      menuId: "abc",
      tableLabel: "4",
    });
    expect(parseTableLink({ menu: "abc", table: ["7", "8"] })).toEqual({
      menuId: "abc",
      tableLabel: "7",
    });
    expect(parseTableLink(new URLSearchParams("menu=abc"))).toBeNull();
    expect(parseTableLink({ table: "4" })).toBeNull();
    expect(parseTableLink({ menu: "abc", table: "   " })).toBeNull();
  });

  it("formats a table label without doubling the word Table", () => {
    expect(formatTableLabel("Table 3")).toBe("Table 3");
    expect(formatTableLabel("3")).toBe("Table 3");
    expect(formatTableLabel("Patio 2")).toBe("Patio 2");
    expect(formatTableLabel("  ")).toBe("Table");
  });

  it("prints a URL without its scheme or encoded spaces", () => {
    expect(displayTableUrl("https://example.test/m/cafe/order?table=Table+3")).toBe(
      "example.test/m/cafe/order?table=Table 3"
    );
    expect(displayTableUrl("http://localhost:3200/order?menu=m1&table=Patio%202")).toBe(
      "localhost:3200/order?menu=m1&table=Patio 2"
    );
  });

  it("builds public table links from a published slug", () => {
    expect(publicTableOrderPath("my-cafe", "Patio 2")).toBe("/m/my-cafe/order?table=Patio+2");
    expect(publicTableOrderUrl("https://example.test/", "my-cafe", "3")).toBe(
      "https://example.test/m/my-cafe/order?table=3"
    );
  });
});
