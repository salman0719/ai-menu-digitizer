import { describe, expect, it } from "vitest";

import { createSampleMenuDocument } from "../src/features/menu/sample-menu";
import {
  menuFilename,
  menuToCsv,
  parseImportedMenu,
  serializeMenu,
} from "../src/features/menu/import-export";

describe("menu JSON round-trip", () => {
  it("serializes and re-imports without losing content", () => {
    const original = createSampleMenuDocument();
    const revived = parseImportedMenu(serializeMenu(original));
    expect(revived.categories).toHaveLength(original.categories.length);
    expect(revived.categories[0].items.map((i) => i.name)).toEqual(
      original.categories[0].items.map((i) => i.name)
    );
    // Re-importing creates a copy: fresh document id, preserved inner ids.
    expect(revived.id).not.toBe(original.id);
    expect(revived.categories[0].id).toBe(original.categories[0].id);
  });

  it("rejects non-JSON and schema-invalid files with helpful errors", () => {
    expect(() => parseImportedMenu("nope{")).toThrow(/not valid JSON/);
    expect(() => parseImportedMenu('{"schemaVersion":1}')).toThrow(/not a valid menu/);
    expect(() =>
      parseImportedMenu(
        JSON.stringify({
          schemaVersion: 1,
          id: "m",
          title: "Bad",
          currency: null,
          updatedAt: "now",
          categories: [{ id: "c", name: "X", sortOrder: 0, items: [{ id: "i" }] }],
        })
      )
    ).toThrow(/items\.0\.name/);
  });
});

describe("menuToCsv", () => {
  it("escapes commas, quotes, and line breaks correctly", () => {
    const doc = createSampleMenuDocument();
    doc.categories = [
      {
        id: "c1",
        name: 'Mains, "Specials"',
        sortOrder: 0,
        items: [
          {
            id: "i1",
            name: 'Ham, "Deluxe"',
            description: "Line one\nLine two",
            price: 12.5,
            currency: "$",
            sortOrder: 0,
            available: false,
            dietaryLabels: ["vegan", "gluten-free"],
            variants: [],
            options: [],
            reviewNotes: [],
          },
          {
            id: "i2",
            name: "Mystery",
            description: null,
            price: null,
            currency: null,
            sortOrder: 1,
            available: null,
            dietaryLabels: [],
            variants: [],
            options: [],
            reviewNotes: [],
          },
        ],
      },
    ];
    expect(menuToCsv(doc)).toBe(
      "category,name,description,price,currency,available,dietary_labels\r\n" +
        '"Mains, ""Specials""","Ham, ""Deluxe""","Line one\nLine two",12.5,$,false,vegan; gluten-free\r\n' +
        '"Mains, ""Specials""",Mystery,,,USD,,\r\n'
    );
  });
});

describe("menuFilename", () => {
  it("builds safe predictable filenames with a fallback", () => {
    expect(menuFilename("Sunny Side Café!", "json")).toBe("sunny-side-caf.json");
    expect(menuFilename("  Tacos & Burritos  ", "csv")).toBe("tacos-burritos.csv");
    expect(menuFilename("", "json")).toBe("menu.json");
    expect(menuFilename(null, "csv")).toBe("menu.csv");
  });
});
