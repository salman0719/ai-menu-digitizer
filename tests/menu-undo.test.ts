import { describe, expect, it } from "vitest";

import {
  addCategory,
  addItem,
  createMenuDocument,
  deleteCategory,
  deleteItem,
  renameCategory,
} from "../src/features/menu/menu-utils";
import {
  canRestoreDeleteUndo,
  captureDeleteUndo,
  restoreDeleteUndo,
} from "../src/features/menu/undo";

function setupMenu() {
  let doc = createMenuDocument({ title: "Test", currency: "USD" });
  doc = addCategory(doc, { name: "Drinks" });
  doc = addCategory(doc, { name: "Food" });
  const [drinksId, foodId] = doc.categories.map((c) => c.id);
  doc = addItem(doc, drinksId, { name: "Espresso", price: 3 });
  doc = addItem(doc, drinksId, { name: "Latte", price: 4 });
  doc = addItem(doc, foodId, { name: "Toast", price: 5 });
  return { doc, drinksId, foodId };
}

describe("delete undo", () => {
  it("captures the document from before and after a deletion", () => {
    const { doc, drinksId } = setupMenu();
    const itemId = doc.categories[0].items[0].id;
    const after = deleteItem(doc, drinksId, itemId);
    const undo = captureDeleteUndo(doc, after, "deleted item “Espresso”");

    expect(undo.label).toBe("deleted item “Espresso”");
    expect(undo.before).toEqual(doc);
    expect(undo.after).toEqual(after);
    expect(canRestoreDeleteUndo(undo, after)).toBe(true);
    expect(restoreDeleteUndo(undo)).toEqual(doc);
  });

  it("clones both sides so later edits cannot corrupt the snapshot", () => {
    const { doc, drinksId } = setupMenu();
    const itemId = doc.categories[0].items[0].id;
    const after = deleteItem(doc, drinksId, itemId);
    const undo = captureDeleteUndo(doc, after, "deleted item");

    // Mutate the inputs the caller still holds.
    doc.categories[0].items[0].name = "Mutated";
    after.categories[0].name = "Mutated too";

    expect(canRestoreDeleteUndo(undo, after)).toBe(false);
    expect(restoreDeleteUndo(undo).categories[0].items[0].name).toBe("Espresso");
  });

  it("treats an identical document as restorable regardless of key order or serialization", () => {
    const { doc, drinksId } = setupMenu();
    const itemId = doc.categories[0].items[0].id;
    const after = deleteItem(doc, drinksId, itemId);
    const undo = captureDeleteUndo(doc, after, "deleted item");

    // Same content, JSON round-trip (as if reopened from IndexedDB).
    expect(canRestoreDeleteUndo(undo, JSON.parse(JSON.stringify(after)))).toBe(true);

    // Same content with object keys reordered (`title` moved to the end).
    const { title, ...rest } = after;
    const reordered = { ...rest, title };
    expect(Object.keys(reordered)).not.toEqual(Object.keys(after));
    expect(canRestoreDeleteUndo(undo, reordered)).toBe(true);
  });

  it("goes stale once anything else changes, so undo never discards newer work", () => {
    const { doc, drinksId, foodId } = setupMenu();
    const itemId = doc.categories[0].items[0].id;
    const after = deleteItem(doc, drinksId, itemId);
    const undo = captureDeleteUndo(doc, after, "deleted item");

    // A text edit after the deletion.
    expect(canRestoreDeleteUndo(undo, renameCategory(after, foodId, "Bites"))).toBe(false);
    // Another deletion replacing this one.
    expect(canRestoreDeleteUndo(undo, deleteCategory(after, foodId))).toBe(false);
    // An addition.
    expect(canRestoreDeleteUndo(undo, addItem(after, foodId, { name: "Soup" }))).toBe(false);
    // Opening a different menu entirely.
    expect(canRestoreDeleteUndo(undo, createMenuDocument({ title: "Other" }))).toBe(false);
  });

  it("restores a fresh clone, leaving the snapshot reusable", () => {
    const { doc, drinksId } = setupMenu();
    const itemId = doc.categories[0].items[0].id;
    const undo = captureDeleteUndo(doc, deleteItem(doc, drinksId, itemId), "deleted item");

    const restored = restoreDeleteUndo(undo);
    expect(restored.categories[0].items).toHaveLength(2);
    restored.categories[0].items[0].name = "Changed";
    expect(restoreDeleteUndo(undo).categories[0].items[0].name).toBe("Espresso");
  });

  it("handles a category deletion with all of its items", () => {
    const { doc, foodId } = setupMenu();
    const after = deleteCategory(doc, foodId);
    const undo = captureDeleteUndo(doc, after, "deleted category “Food”");

    expect(restoreDeleteUndo(undo).categories).toHaveLength(2);
    expect(restoreDeleteUndo(undo).categories[1].items.map((i) => i.name)).toEqual(["Toast"]);
    expect(canRestoreDeleteUndo(undo, after)).toBe(true);
  });
});
