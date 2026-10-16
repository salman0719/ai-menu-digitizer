import { describe, expect, it } from "vitest";

import { addCategory, addItem, createMenuDocument } from "../src/features/menu/menu-utils";
import { searchMenu } from "../src/features/menu/search";

function setupMenu() {
  let doc = createMenuDocument({ title: "Café" });
  doc = addCategory(doc, { name: "Coffee" });
  doc = addCategory(doc, { name: "Food" });
  const [coffeeId, foodId] = doc.categories.map((c) => c.id);
  doc = addItem(doc, coffeeId, { name: "Espresso", price: 3 });
  doc = addItem(doc, coffeeId, { name: "Latte", price: 4, description: "Double shot milk" });
  doc = addItem(doc, foodId, { name: "Toastie", price: 6, description: "Ham and cheese" });
  return doc;
}

describe("searchMenu", () => {
  it("returns the whole menu for an empty or whitespace query", () => {
    const doc = setupMenu();
    for (const query of ["", "   "]) {
      const result = searchMenu(doc, query);
      expect(result.categories).toHaveLength(2);
      expect(result.matchCount).toBe(3);
      expect(result.totalItems).toBe(3);
      expect(result.categories[0].items).toHaveLength(2);
    }
  });

  it("keeps original identity so filtering does not disturb editing", () => {
    const doc = setupMenu();
    const result = searchMenu(doc, "latte");
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].category.id).toBe(doc.categories[0].id);
    expect(result.categories[0].items[0].id).toBe(doc.categories[0].items[1].id);
    expect(result.categories[0].items[0].sortOrder).toBe(1);
  });

  it("matches item names case-insensitively across categories", () => {
    const doc = setupMenu();
    const result = searchMenu(doc, "ESPRESS");
    expect(result.categories.map((m) => m.category.name)).toEqual(["Coffee"]);
    expect(result.categories[0].items.map((i) => i.name)).toEqual(["Espresso"]);
    expect(result.matchCount).toBe(1);
    expect(result.totalItems).toBe(3);
  });

  it("matches item descriptions", () => {
    const doc = setupMenu();
    const result = searchMenu(doc, "ham and");
    expect(result.categories.map((m) => m.category.name)).toEqual(["Food"]);
    expect(result.categories[0].items.map((i) => i.name)).toEqual(["Toastie"]);
  });

  it("shows every item when the category name matches", () => {
    const doc = setupMenu();
    const result = searchMenu(doc, "coffee");
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].items.map((i) => i.name)).toEqual(["Espresso", "Latte"]);
    expect(result.matchCount).toBe(2);
  });

  it("hides categories with no matches and reports an empty result", () => {
    const doc = setupMenu();
    const result = searchMenu(doc, "zzz-not-on-this-menu");
    expect(result.categories).toEqual([]);
    expect(result.matchCount).toBe(0);
    expect(result.totalItems).toBe(3);
  });
});
