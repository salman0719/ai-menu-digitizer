import { describe, expect, it } from "vitest";

import {
  addCategory,
  addItem,
  createMenuDocument,
  deleteCategory,
  deleteItem,
  duplicateItem,
  moveCategory,
  moveItem,
  moveItemToCategory,
  moveItemsToCategory,
  renameCategory,
  setItemAvailability,
  updateItem,
} from "../src/features/menu/menu-utils";

function setupTwoCategoryMenu() {
  let doc = createMenuDocument({ title: "Test", currency: "USD" });
  doc = addCategory(doc, { name: "Drinks" });
  doc = addCategory(doc, { name: "Food" });
  const [drinksId, foodId] = doc.categories.map((c) => c.id);
  doc = addItem(doc, drinksId, { name: "Espresso", price: 3 });
  doc = addItem(doc, drinksId, { name: "Latte", price: 4 });
  doc = addItem(doc, foodId, { name: "Toast", price: 5 });
  return { doc, drinksId, foodId };
}

describe("menu-utils", () => {
  it("creates documents with unique ids and dense ordering", () => {
    const { doc, drinksId } = setupTwoCategoryMenu();
    const drinks = doc.categories.find((c) => c.id === drinksId)!;
    expect(doc.categories.map((c) => c.sortOrder)).toEqual([0, 1]);
    expect(drinks.items.map((i) => i.sortOrder)).toEqual([0, 1]);
    const ids = new Set([
      doc.id,
      ...doc.categories.flatMap((c) => [c.id, ...c.items.map((i) => i.id)]),
    ]);
    expect(ids.size).toBe(1 + 2 + 3);
  });

  it("renames categories and items, rejecting empty names", () => {
    const { doc, drinksId } = setupTwoCategoryMenu();
    const renamed = renameCategory(doc, drinksId, "Hot Drinks");
    expect(renamed.categories.find((c) => c.id === drinksId)!.name).toBe("Hot Drinks");
    expect(() => renameCategory(doc, drinksId, "   ")).toThrow();
    const itemId = doc.categories[0].items[0].id;
    expect(() => updateItem(doc, drinksId, itemId, { name: "" })).toThrow();
  });

  it("reorders categories and items within a category", () => {
    const { doc, drinksId } = setupTwoCategoryMenu();
    const moved = moveCategory(doc, drinksId, 1);
    expect(moved.categories[1].id).toBe(drinksId);
    expect(moved.categories.map((c) => c.sortOrder)).toEqual([0, 1]);

    const [firstId, secondId] = doc.categories[0].items.map((i) => i.id);
    const reordered = moveItem(doc, drinksId, firstId, 5);
    const ids = reordered.categories[0].items.map((i) => i.id);
    expect(ids).toEqual([secondId, firstId]);
    expect(reordered.categories[0].items.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it("moves items across categories", () => {
    const { doc, drinksId, foodId } = setupTwoCategoryMenu();
    const itemId = doc.categories[0].items[0].id;
    const moved = moveItemToCategory(doc, drinksId, foodId, itemId, 0);
    expect(moved.categories[0].items).toHaveLength(1);
    expect(moved.categories[1].items[0].id).toBe(itemId);
    expect(moved.categories[1].items.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it("duplicates items with a fresh id directly after the original", () => {
    const { doc, drinksId } = setupTwoCategoryMenu();
    const itemId = doc.categories[0].items[0].id;
    const duplicated = duplicateItem(doc, drinksId, itemId);
    const items = duplicated.categories[0].items;
    expect(items).toHaveLength(3);
    expect(items[1].name).toBe("Espresso (copy)");
    expect(items[1].id).not.toBe(itemId);
  });

  it("deletes items and categories, renumbering afterwards", () => {
    const { doc, drinksId, foodId } = setupTwoCategoryMenu();
    const itemId = doc.categories[0].items[0].id;
    const afterDelete = deleteItem(doc, drinksId, itemId);
    expect(afterDelete.categories[0].items.map((i) => i.sortOrder)).toEqual([0]);
    const afterCatDelete = deleteCategory(afterDelete, foodId);
    expect(afterCatDelete.categories).toHaveLength(1);
    expect(afterCatDelete.categories[0].sortOrder).toBe(0);
  });

  it("moves multiple items across categories at once", () => {
    const { doc } = setupTwoCategoryMenu();
    const three = addCategory(doc, { name: "Sides" });
    const sidesId = three.categories[2].id;
    const espressoId = three.categories[0].items[0].id; // in Drinks
    const toastId = three.categories[1].items[0].id; // in Food

    // Ref order is scrambled on purpose: output must follow document order.
    const moved = moveItemsToCategory(three, [toastId, espressoId], sidesId);

    expect(moved.categories[0].items.map((i) => i.name)).toEqual(["Latte"]);
    expect(moved.categories[1].items).toHaveLength(0);
    expect(moved.categories[2].items.map((i) => i.id)).toEqual([espressoId, toastId]);
    expect(moved.categories[2].items.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(moved.categories.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    // Inputs are never mutated.
    expect(three.categories[0].items).toHaveLength(2);
    expect(doc.categories[0].items).toHaveLength(2);
  });

  it("deduplicates repeated ids, no-ops on an empty selection, throws on unknown ids", () => {
    const { doc, drinksId, foodId } = setupTwoCategoryMenu();
    const espressoId = doc.categories[0].items[0].id;

    const moved = moveItemsToCategory(doc, [espressoId, espressoId], foodId);
    expect(moved.categories[1].items.filter((i) => i.id === espressoId)).toHaveLength(1);
    expect(moved.categories[1].items.map((i) => i.sortOrder)).toEqual([0, 1]);

    // Moving into the item's own category appends it there (reordered, kept).
    const self = moveItemsToCategory(doc, [espressoId], drinksId);
    expect(self.categories[0].items.map((i) => i.id)).toEqual([
      doc.categories[0].items[1].id,
      espressoId,
    ]);

    expect(moveItemsToCategory(doc, [], foodId)).toBe(doc);
    expect(() => moveItemsToCategory(doc, ["nope"], foodId)).toThrow();
    expect(() => moveItemsToCategory(doc, [espressoId], "nope")).toThrow();
  });

  it("marks availability without deleting", () => {
    const { doc, drinksId } = setupTwoCategoryMenu();
    const itemId = doc.categories[0].items[0].id;
    expect(setItemAvailability(doc, drinksId, itemId, false).categories[0].items[0].available).toBe(
      false
    );
    expect(
      setItemAvailability(doc, drinksId, itemId, null).categories[0].items[0].available
    ).toBeNull();
  });

  it("inherits document currency for new items and never mutates inputs", () => {
    const { doc, drinksId } = setupTwoCategoryMenu();
    const withCurrency = addItem(doc, drinksId, { name: "Mocha", price: 4.5 });
    const mocha = withCurrency.categories[0].items[2];
    expect(mocha.currency).toBe("USD");
    // Original document untouched by any helper.
    expect(doc.categories[0].items).toHaveLength(2);
  });

  it("throws on unknown ids", () => {
    const { doc } = setupTwoCategoryMenu();
    expect(() => renameCategory(doc, "nope", "X")).toThrow();
    expect(() => deleteCategory(doc, "nope")).toThrow();
    expect(() => addItem(doc, "nope", { name: "X" })).toThrow();
    expect(() => deleteItem(doc, doc.categories[0].id, "nope")).toThrow();
  });
});
