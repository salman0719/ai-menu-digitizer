/**
 * Pure filtering for the editor's search box.
 *
 * Rules:
 * - Empty/whitespace query → the whole menu, unchanged.
 * - A query matches case-insensitively (substring) against category names,
 *   item names, and item descriptions.
 * - When a category name matches, the category is shown with ALL its items
 *   (the heading is what the user searched for); otherwise only the items
 *   that match are shown, and categories with no matches are hidden.
 *
 * Returned categories/items keep their original identity (ids, sortOrder),
 * so editing, reordering, and the "Category N" labels keep working while
 * filtered.
 */

import type { MenuCategory, MenuDocument, MenuItem } from "./schema";

export interface SearchMatch {
  category: MenuCategory;
  /** Items to render under this category. */
  items: MenuItem[];
}

export interface MenuSearchResult {
  categories: SearchMatch[];
  /** Number of items currently shown. */
  matchCount: number;
  /** Number of items in the document overall. */
  totalItems: number;
}

function contains(query: string, value: string | null | undefined): boolean {
  return (value ?? "").toLowerCase().includes(query);
}

export function searchMenu(doc: MenuDocument, rawQuery: string): MenuSearchResult {
  const totalItems = doc.categories.reduce((sum, category) => sum + category.items.length, 0);
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return {
      categories: doc.categories.map((category) => ({ category, items: category.items })),
      matchCount: totalItems,
      totalItems,
    };
  }

  const categories: SearchMatch[] = [];
  for (const category of doc.categories) {
    if (contains(query, category.name)) {
      categories.push({ category, items: category.items });
      continue;
    }
    const items = category.items.filter(
      (item) => contains(query, item.name) || contains(query, item.description)
    );
    if (items.length > 0) categories.push({ category, items });
  }

  return {
    categories,
    matchCount: categories.reduce((sum, match) => sum + match.items.length, 0),
    totalItems,
  };
}
