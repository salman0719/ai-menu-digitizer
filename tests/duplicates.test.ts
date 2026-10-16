import { afterEach, describe, expect, it, vi } from "vitest";

import {
  duplicateItemIds,
  findDuplicateGroups,
  loadDismissedDuplicateKeys,
  normalizeItemName,
  saveDismissedDuplicateKeys,
} from "../src/features/menu/duplicates";
import {
  addCategory,
  addItem,
  createMenuDocument,
  duplicateItem,
} from "../src/features/menu/menu-utils";

function setupDuplicateMenu() {
  let doc = createMenuDocument({ title: "Test", currency: "USD" });
  doc = addCategory(doc, { name: "Drinks" });
  doc = addCategory(doc, { name: "Food" });
  const [drinksId, foodId] = doc.categories.map((c) => c.id);
  doc = addItem(doc, drinksId, { name: "Espresso", price: 3 });
  doc = addItem(doc, drinksId, { name: "Latte", price: 4 });
  doc = addItem(doc, foodId, { name: "Toast", price: 5 });
  // Same dish extracted again from page 2, in a different category.
  doc = addItem(doc, foodId, { name: " espresso. ", price: 3 });
  return { doc, drinksId, foodId };
}

describe("normalizeItemName", () => {
  it("lowercases, collapses whitespace, and strips trailing punctuation", () => {
    expect(normalizeItemName("  Espresso. ")).toBe("espresso");
    expect(normalizeItemName("Double  Espresso")).toBe("double espresso");
    expect(normalizeItemName("TOAST!!")).toBe("toast");
    expect(normalizeItemName("   ")).toBe("");
  });
});

describe("findDuplicateGroups", () => {
  it("groups same-name items across categories in first-appearance order", () => {
    const { doc, drinksId, foodId } = setupDuplicateMenu();
    const groups = findDuplicateGroups(doc);
    expect(groups).toHaveLength(1);

    const [group] = groups;
    expect(group.key).toBe("espresso");
    expect(group.displayName).toBe("Espresso");
    expect(group.occurrences).toHaveLength(2);
    expect(group.occurrences[0]).toMatchObject({
      categoryId: drinksId,
      categoryName: "Drinks",
    });
    expect(group.occurrences[1]).toMatchObject({
      categoryId: foodId,
      categoryName: "Food",
    });
  });

  it("returns nothing when all names are distinct", () => {
    let doc = createMenuDocument({ title: "Solo" });
    doc = addCategory(doc, { name: "Drinks" });
    doc = addItem(doc, doc.categories[0].id, { name: "Espresso" });
    doc = addItem(doc, doc.categories[0].id, { name: "Latte" });
    expect(findDuplicateGroups(doc)).toEqual([]);
    expect(findDuplicateGroups(createMenuDocument({ title: "Empty" }))).toEqual([]);
  });

  it("does not re-flag manual duplicates created with duplicateItem()", () => {
    const { doc, drinksId } = setupDuplicateMenu();
    const clean = findDuplicateGroups(doc).filter((g) => g.key !== "espresso");
    expect(clean).toEqual([]);

    const espressoId = doc.categories[0].items[0].id;
    const withCopy = duplicateItem(doc, drinksId, espressoId);
    // "Espresso" + " espresso. " still flag; the "(copy)" does not add to them.
    const groups = findDuplicateGroups(withCopy);
    expect(groups).toHaveLength(1);
    expect(groups[0].occurrences).toHaveLength(2);
  });

  it("collects flagged ids for row badges", () => {
    const { doc } = setupDuplicateMenu();
    const groups = findDuplicateGroups(doc);
    const ids = duplicateItemIds(groups);
    expect(ids.size).toBe(2);
    for (const id of ids) {
      expect(doc.categories.flatMap((c) => c.items).some((i) => i.id === id)).toBe(true);
    }
  });
});

describe("dismissed duplicate keys", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips per document and defaults safely without storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    expect(loadDismissedDuplicateKeys("doc-1")).toEqual([]);
    saveDismissedDuplicateKeys("doc-1", ["espresso", "toast"]);
    expect(loadDismissedDuplicateKeys("doc-1")).toEqual(["espresso", "toast"]);
    // Dismissals are scoped to their document.
    expect(loadDismissedDuplicateKeys("doc-2")).toEqual([]);

    vi.unstubAllGlobals();
    expect(loadDismissedDuplicateKeys("doc-1")).toEqual([]);
    expect(() => saveDismissedDuplicateKeys("doc-1", ["x"])).not.toThrow();
  });

  it("survives corrupted stored JSON", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{not json",
      setItem: () => {},
    });
    expect(loadDismissedDuplicateKeys("doc-1")).toEqual([]);
  });
});
