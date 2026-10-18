/**
 * Duplicate item detection for merged multi-page menus (PLAN.md §5 P1).
 *
 * Multi-page extraction can surface the same dish twice — once per page, or
 * split across categories. Detection only FLAGS items whose names normalise
 * to the same string; it never deletes or edits anything (PLAN.md: "review
 * action, not automatic deletion"). The editor turns each group into a
 * review action: delete one copy through the usual confirmed delete with
 * one-level undo, or keep all copies and dismiss the group. Dismissals are
 * remembered per document in localStorage (a tiny pref, allowed by the
 * stack rules).
 *
 * Conservative by design: only exact normalised-name matches count, and
 * groups are ordered by first appearance in the document. Manual duplicates
 * created via `duplicateItem()` are suffixed "(copy)", so they are
 * intentionally not re-flagged.
 */

import type { MenuDocument } from "./schema";

export interface DuplicateOccurrence {
  categoryId: string;
  categoryName: string;
  item: MenuDocument["categories"][number]["items"][number];
}

export interface DuplicateGroup {
  /** Normalised name shared by every occurrence; also the dismissal key. */
  key: string;
  /** The raw name as first seen in the document, for display. */
  displayName: string;
  occurrences: DuplicateOccurrence[];
}

/** Trim, lowercase, collapse whitespace runs, and drop trailing punctuation. */
export function normalizeItemName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!,;:]+$/g, "")
    .trim();
}

/**
 * Groups of two or more items sharing a normalised name, in order of first
 * appearance. Items with names that normalise to nothing are ignored.
 */
export function findDuplicateGroups(doc: MenuDocument): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const category of doc.categories) {
    for (const item of category.items) {
      const key = normalizeItemName(item.name);
      if (!key) continue;
      const occurrence: DuplicateOccurrence = {
        categoryId: category.id,
        categoryName: category.name,
        item,
      };
      const existing = groups.get(key);
      if (existing) existing.occurrences.push(occurrence);
      else groups.set(key, { key, displayName: item.name, occurrences: [occurrence] });
    }
  }
  return [...groups.values()].filter((group) => group.occurrences.length > 1);
}

/** Every item id inside any group — for flagging rows in the editor. */
export function duplicateItemIds(groups: DuplicateGroup[]): Set<string> {
  return new Set(groups.flatMap((group) => group.occurrences.map((occ) => occ.item.id)));
}

// --- Dismissal persistence (tiny per-document preference) -----------------

const STORAGE_PREFIX = "menu-duplicate-dismissed:";

function storageKey(docId: string): string {
  return STORAGE_PREFIX + docId;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage access can throw (privacy mode); treat as "nothing dismissed".
    return null;
  }
}

/** Dismissed group keys for one document; never throws. */
export function loadDismissedDuplicateKeys(docId: string): string[] {
  try {
    const raw = storage()?.getItem(storageKey(docId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/** Persist the full dismissal list for one document; never throws. */
export function saveDismissedDuplicateKeys(docId: string, keys: string[]): void {
  try {
    storage()?.setItem(storageKey(docId), JSON.stringify(keys));
  } catch {
    // Quota/privacy failures only lose the dismissal, never data.
  }
}
