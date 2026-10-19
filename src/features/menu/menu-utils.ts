/**
 * Pure edit helpers for {@link MenuDocument}. Every function returns a new
 * document (inputs are never mutated), renumbers `sortOrder` densely from 0
 * in array order, and refreshes `updatedAt`.
 *
 * Array order is authoritative: helpers move elements, then renumber.
 * Unknown category/item IDs throw — callers should only pass IDs taken
 * from the current document.
 */

import { SCHEMA_VERSION, type MenuCategory, type MenuDocument, type MenuItem } from "./schema";
import type { ItemPatch, NewCategoryInput, NewItemInput } from "./types";

export function generateId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Non-secure fallback (non-browser / older runtimes). Uniqueness within a
  // document is what matters; collisions are practically impossible here.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Renumber categories/items 0..n in array order and stamp `updatedAt`. */
function finalize(doc: MenuDocument): MenuDocument {
  doc.categories.forEach((category, categoryIndex) => {
    category.sortOrder = categoryIndex;
    category.items.forEach((item, itemIndex) => {
      item.sortOrder = itemIndex;
    });
  });
  doc.updatedAt = nowIso();
  return doc;
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty.`);
  return trimmed;
}

function findCategory(doc: MenuDocument, categoryId: string): MenuCategory {
  const category = doc.categories.find((c) => c.id === categoryId);
  if (!category) throw new Error(`Unknown category id: ${categoryId}`);
  return category;
}

function findItem(category: MenuCategory, itemId: string): MenuItem {
  const item = category.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`Unknown item id: ${itemId} in category ${category.id}`);
  return item;
}

/** Clamp to a valid splice-insert position (upper bound inclusive: `length` appends). */
function clampInsertIndex(index: number, length: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

/** Create an empty menu document. */
export function createMenuDocument(input?: {
  title?: string;
  currency?: string | null;
}): MenuDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: generateId(),
    title: input?.title?.trim() ? input.title.trim() : "Untitled menu",
    currency: input?.currency ?? null,
    categories: [],
    updatedAt: nowIso(),
  };
}

function buildItem(
  input: NewItemInput,
  sortOrder: number,
  fallbackCurrency: string | null
): MenuItem {
  return {
    id: generateId(),
    name: requireNonEmpty(input.name, "Item name"),
    description: input.description ?? null,
    price: input.price ?? null,
    currency: input.currency ?? fallbackCurrency,
    sortOrder,
    available: input.available ?? null,
    dietaryLabels: input.dietaryLabels ? [...input.dietaryLabels] : [],
    variants: input.variants ? clone(input.variants) : [],
    options: input.options ? clone(input.options) : [],
    reviewNotes: input.reviewNotes ? [...input.reviewNotes] : [],
  };
}

// --- Categories -----------------------------------------------------------

export function addCategory(doc: MenuDocument, input: NewCategoryInput): MenuDocument {
  const next = clone(doc);
  next.categories.push({
    id: generateId(),
    name: requireNonEmpty(input.name, "Category name"),
    sortOrder: next.categories.length,
    items: [],
  });
  return finalize(next);
}

export function renameCategory(doc: MenuDocument, categoryId: string, name: string): MenuDocument {
  const next = clone(doc);
  findCategory(next, categoryId).name = requireNonEmpty(name, "Category name");
  return finalize(next);
}

/** Delete a category and all its items. Callers must confirm with the user first. */
export function deleteCategory(doc: MenuDocument, categoryId: string): MenuDocument {
  const next = clone(doc);
  const index = next.categories.findIndex((c) => c.id === categoryId);
  if (index === -1) throw new Error(`Unknown category id: ${categoryId}`);
  next.categories.splice(index, 1);
  return finalize(next);
}

export function moveCategory(doc: MenuDocument, categoryId: string, toIndex: number): MenuDocument {
  const next = clone(doc);
  const fromIndex = next.categories.findIndex((c) => c.id === categoryId);
  if (fromIndex === -1) throw new Error(`Unknown category id: ${categoryId}`);
  const [category] = next.categories.splice(fromIndex, 1);
  next.categories.splice(clampInsertIndex(toIndex, next.categories.length), 0, category);
  return finalize(next);
}

// --- Items ----------------------------------------------------------------

export function addItem(doc: MenuDocument, categoryId: string, input: NewItemInput): MenuDocument {
  const next = clone(doc);
  const category = findCategory(next, categoryId);
  category.items.push(buildItem(input, category.items.length, next.currency));
  return finalize(next);
}

export function updateItem(
  doc: MenuDocument,
  categoryId: string,
  itemId: string,
  patch: ItemPatch
): MenuDocument {
  const next = clone(doc);
  const item = findItem(findCategory(next, categoryId), itemId);
  // `id` and `sortOrder` are immutable by type; strip defensively at runtime
  // in case a caller bypasses the types (e.g. with parsed JSON).
  const rest: Record<string, unknown> = { ...patch };
  delete rest.id;
  delete rest.sortOrder;
  if (rest.name !== undefined) rest.name = requireNonEmpty(String(rest.name), "Item name");
  Object.assign(item, clone(rest));
  return finalize(next);
}

/** Duplicate an item directly after the original with a fresh id. */
export function duplicateItem(doc: MenuDocument, categoryId: string, itemId: string): MenuDocument {
  const next = clone(doc);
  const category = findCategory(next, categoryId);
  const index = category.items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new Error(`Unknown item id: ${itemId} in category ${categoryId}`);
  const copy: MenuItem = { ...clone(category.items[index]), id: generateId() };
  copy.name = `${category.items[index].name} (copy)`;
  category.items.splice(index + 1, 0, copy);
  return finalize(next);
}

/** Delete an item. Callers must confirm with the user where appropriate. */
export function deleteItem(doc: MenuDocument, categoryId: string, itemId: string): MenuDocument {
  const next = clone(doc);
  const category = findCategory(next, categoryId);
  const index = category.items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new Error(`Unknown item id: ${itemId} in category ${categoryId}`);
  category.items.splice(index, 1);
  return finalize(next);
}

/** Reorder an item within its category. */
export function moveItem(
  doc: MenuDocument,
  categoryId: string,
  itemId: string,
  toIndex: number
): MenuDocument {
  const next = clone(doc);
  const category = findCategory(next, categoryId);
  const fromIndex = category.items.findIndex((i) => i.id === itemId);
  if (fromIndex === -1) throw new Error(`Unknown item id: ${itemId} in category ${categoryId}`);
  const [item] = category.items.splice(fromIndex, 1);
  category.items.splice(clampInsertIndex(toIndex, category.items.length), 0, item);
  return finalize(next);
}

/**
 * Move an item to another category (appended at `toIndex`, default end).
 */
export function moveItemToCategory(
  doc: MenuDocument,
  fromCategoryId: string,
  toCategoryId: string,
  itemId: string,
  toIndex?: number
): MenuDocument {
  const next = clone(doc);
  const from = findCategory(next, fromCategoryId);
  const to = findCategory(next, toCategoryId);
  const index = from.items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new Error(`Unknown item id: ${itemId} in category ${fromCategoryId}`);
  const [item] = from.items.splice(index, 1);
  to.items.splice(
    toIndex === undefined ? to.items.length : clampInsertIndex(toIndex, to.items.length),
    0,
    item
  );
  return finalize(next);
}

/**
 * Move several items to another category at once (bulk reassignment).
 *
 * `itemIds` are item ids (unique within a document); repeated ids are
 * ignored. Moved items keep their document order and land at the end of the
 * target category. Unknown item or category ids throw; an empty selection
 * returns the document unchanged.
 */
export function moveItemsToCategory(
  doc: MenuDocument,
  itemIds: ReadonlyArray<string>,
  toCategoryId: string
): MenuDocument {
  if (itemIds.length === 0) return doc;
  const next = clone(doc);
  const target = findCategory(next, toCategoryId);
  const wanted = new Set(itemIds);

  const collected: MenuItem[] = [];
  for (const category of next.categories) {
    const staying: MenuItem[] = [];
    for (const item of category.items) {
      if (wanted.has(item.id)) collected.push(item);
      else staying.push(item);
    }
    category.items = staying;
  }

  const found = new Set(collected.map((item) => item.id));
  for (const id of wanted) {
    if (!found.has(id)) throw new Error(`Unknown item id: ${id}`);
  }

  target.items.push(...collected);
  return finalize(next);
}

/** Mark an item available/unavailable (null = unknown) without deleting it. */
export function setItemAvailability(
  doc: MenuDocument,
  categoryId: string,
  itemId: string,
  available: boolean | null
): MenuDocument {
  return updateItem(doc, categoryId, itemId, { available });
}

/** Where a menu title usually splits into "place — which menu". */
const TITLE_SEPARATORS = [" — ", " – ", " · ", " | ", " - ", ":"];

/**
 * Suggest a restaurant name from local menu titles for the first-run
 * "Name your restaurant" field. Each title contributes the part before a
 * separator ("—", "–", "·", "|", spaced "-", ":"), minus a trailing "menu"
 * word; the most common leftover wins, keeping its first-seen casing.
 * Suggestion only — the field stays editable, and nothing is invented when
 * the titles say nothing (returns null).
 */
export function suggestRestaurantName(titles: string[]): string | null {
  const seen = new Map<string, { count: number; display: string }>();
  for (const title of titles) {
    const candidate = restaurantNameCandidate(title);
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { count: 1, display: candidate });
  }
  let best: { count: number; display: string } | null = null;
  for (const entry of seen.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return null;
  // The create API caps names at 120 characters.
  return best.display.slice(0, 120).trim() || null;
}

/** The restaurant-name part of one title, or null when it has none. */
function restaurantNameCandidate(title: string): string | null {
  let candidate = title.trim();
  if (!candidate) return null;
  for (const separator of TITLE_SEPARATORS) {
    const index = candidate.indexOf(separator);
    if (index >= 0) {
      candidate = candidate.slice(0, index);
      break;
    }
  }
  candidate = candidate.replace(/(\s+|^)menu$/i, "").trim();
  if (!candidate) candidate = title.trim().replace(/(\s+|^)menu$/i, "").trim();
  return candidate || null;
}
