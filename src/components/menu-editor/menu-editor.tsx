"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  addCategory,
  addItem,
  deleteCategory,
  deleteItem,
  moveCategory,
  moveItemsToCategory,
  renameCategory,
} from "@/features/menu/menu-utils";
import {
  findDuplicateGroups,
  duplicateItemIds,
  loadDismissedDuplicateKeys,
  saveDismissedDuplicateKeys,
} from "@/features/menu/duplicates";
import type { MenuCategory, MenuDocument, MenuItem } from "@/features/menu/schema";
import { searchMenu } from "@/features/menu/search";
import {
  canRestoreDeleteUndo,
  captureDeleteUndo,
  restoreDeleteUndo,
  type DeleteUndo,
} from "@/features/menu/undo";

import {
  DEFAULT_PREVIEW_LAYOUT_ID,
  DEFAULT_PREVIEW_THEME_ID,
  PREVIEW_THEMES,
  PREVIEW_THEME_IDS,
  isPreviewLayoutId,
  isPreviewThemeId,
  type PreviewLayoutId,
  type PreviewThemeId,
} from "@/features/menu/preview-themes";

import { CommitInput } from "./fields";
import { ItemEditor } from "./item-editor";
import { MenuPreview } from "./menu-preview";

export interface SaveState {
  kind: "saved" | "saving" | "error";
  message: string;
}

interface MenuEditorProps {
  doc: MenuDocument;
  onChange: (next: MenuDocument) => void;
  saveState: SaveState;
  imageUrl: string | null;
  onExportJson: () => void;
  onExportCsv: () => void;
  onImportFile: (file: File) => void;
  importError: string | null;
  onDeleteMenu: () => void;
  onBack: () => void;
}

const smallButton =
  "rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors " +
  "hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700";

const primaryButton =
  "rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors " +
  "hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700";

/**
 * Category layout: "single" shows one category at a time behind a horizontal
 * chip carousel; "all" is the legacy vertical stack of every category. The
 * choice is a tiny UI preference, so it is remembered in localStorage.
 */
type CategoryViewMode = "single" | "all";

const VIEW_MODE_STORAGE_KEY = "menu-editor-category-view";

function viewModeButton(active: boolean): string {
  return (
    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 " +
    (active ? "bg-amber-800 text-white" : "text-stone-600 hover:text-amber-900")
  );
}

export function MenuEditor({
  doc,
  onChange,
  saveState,
  imageUrl,
  onExportJson,
  onExportCsv,
  onImportFile,
  importError,
  onDeleteMenu,
  onBack,
}: MenuEditorProps) {
  const reviewCount = doc.categories.reduce(
    (sum, c) => sum + c.items.filter((i) => i.price === null || i.reviewNotes.length > 0).length,
    0
  );

  // Search box: pure client-side filter, see search.ts for the rules.
  const [query, setQuery] = useState("");
  const search = searchMenu(doc, query);
  const isFiltering = query.trim().length > 0;

  // Category carousel. The active category resolves against the visible
  // (search-filtered) list, so a deleted category — or one filtered out of a
  // search — falls back to the first visible category instead of blanking.
  // Restore the persisted layout preference. The editor only ever mounts
  // client-side (the page opens it after user interaction), so reading
  // localStorage in the initializer is hydration-safe; if storage is blocked
  // or empty, default to the carousel.
  const [viewMode, setViewMode] = useState<CategoryViewMode>(() => {
    if (typeof window === "undefined") return "single";
    try {
      return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "all" ? "all" : "single";
    } catch {
      return "single";
    }
  });
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const activeChipRef = useRef<HTMLButtonElement | null>(null);
  const activeMatch =
    search.categories.find((match) => match.category.id === activeCategoryId) ??
    search.categories[0] ??
    null;

  // Keep the active chip visible inside the horizontally scrolling row.
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeMatch?.category.id, viewMode, query]);

  function changeViewMode(mode: CategoryViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      /* storage unavailable — the session default is fine */
    }
  }

  /** Left/Right/Home/End navigation across the category chips. */
  function handleChipListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const ids = search.categories.map((match) => match.category.id);
    const currentIndex = ids.indexOf(activeMatch?.category.id ?? "");
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % ids.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = ids.length - 1;
    if (nextIndex === null || !ids[nextIndex]) return;
    event.preventDefault();
    const nextId = ids[nextIndex];
    setActiveCategoryId(nextId);
    requestAnimationFrame(() => document.getElementById(`category-chip-${nextId}`)?.focus());
  }

  // Duplicate review (flags only, never auto-deletes — see duplicates.ts).
  // Dismissals are remembered per document, in session state and localStorage.
  const [dismissedMap, setDismissedMap] = useState<Record<string, string[]>>({});
  const dismissedKeys = dismissedMap[doc.id] ?? loadDismissedDuplicateKeys(doc.id);
  const duplicateGroups = findDuplicateGroups(doc).filter(
    (group) => !dismissedKeys.includes(group.key)
  );
  const duplicateIds = duplicateItemIds(duplicateGroups);

  function dismissGroup(key: string) {
    const current = dismissedMap[doc.id] ?? dismissedKeys;
    const next = current.includes(key) ? current : [...current, key];
    saveDismissedDuplicateKeys(doc.id, next);
    setDismissedMap((prev) => ({ ...prev, [doc.id]: next }));
  }

  // One-level undo for deletions. The snapshot only stays offered while the
  // document still matches the post-delete state — see undo.ts.
  const [undo, setUndo] = useState<DeleteUndo | null>(null);
  const undoLabel = undo && canRestoreDeleteUndo(undo, doc) ? undo.label : null;

  /** Delete an item, keeping a one-level undo of the document beforehand. */
  function removeItem(categoryId: string, item: MenuItem) {
    if (!window.confirm(`Delete “${item.name}”? You can undo this until your next change.`)) {
      return;
    }
    const next = deleteItem(doc, categoryId, item.id);
    setUndo(captureDeleteUndo(doc, next, `deleted “${item.name}”`));
    onChange(next);
  }

  function handleUndo() {
    if (!undo || !canRestoreDeleteUndo(undo, doc)) return;
    setUndo(null);
    onChange(restoreDeleteUndo(undo));
  }

  /** Delete a category (after confirm), keeping undo and the carousel sane. */
  function handleDeleteCategory(category: MenuCategory, index: number) {
    if (
      !window.confirm(
        `Delete category “${category.name}” and its ${category.items.length} items? You can undo this until your next change.`
      )
    ) {
      return;
    }
    const next = deleteCategory(doc, category.id);
    setUndo(captureDeleteUndo(doc, next, `deleted category “${category.name}”`));
    // Keep the carousel on the category that takes this one's place (or the
    // new last one); null when the menu is now empty.
    setActiveCategoryId(next.categories[Math.min(index, next.categories.length - 1)]?.id ?? null);
    onChange(next);
  }

  /** Add a category and, in single view, open it straight away. */
  function handleAddCategory() {
    const next = addCategory(doc, { name: "New category" });
    setActiveCategoryId(next.categories[next.categories.length - 1]?.id ?? null);
    onChange(next);
  }

  // Live customer-facing preview: swaps the editing surface for the menu a
  // diner would see, while the header (back, undo, save state) stays reachable.
  const [previewing, setPreviewing] = useState(false);

  // Preview style is a tiny UI preference (like the category layout above), so
  // it lives in localStorage rather than the menu document.
  const PREVIEW_THEME_STORAGE_KEY = "menu-preview-theme";
  const [previewThemeId, setPreviewThemeId] = useState<PreviewThemeId>(() => {
    if (typeof window === "undefined") return DEFAULT_PREVIEW_THEME_ID;
    try {
      const stored = window.localStorage.getItem(PREVIEW_THEME_STORAGE_KEY);
      return isPreviewThemeId(stored) ? stored : DEFAULT_PREVIEW_THEME_ID;
    } catch {
      return DEFAULT_PREVIEW_THEME_ID;
    }
  });

  function changePreviewTheme(id: PreviewThemeId) {
    setPreviewThemeId(id);
    try {
      window.localStorage.setItem(PREVIEW_THEME_STORAGE_KEY, id);
    } catch {
      /* storage unavailable — the session choice still applies */
    }
  }

  const PREVIEW_LAYOUT_STORAGE_KEY = "menu-preview-layout";
  const [previewLayout, setPreviewLayout] = useState<PreviewLayoutId>(() => {
    if (typeof window === "undefined") return DEFAULT_PREVIEW_LAYOUT_ID;
    try {
      const stored = window.localStorage.getItem(PREVIEW_LAYOUT_STORAGE_KEY);
      return isPreviewLayoutId(stored) ? stored : DEFAULT_PREVIEW_LAYOUT_ID;
    } catch {
      return DEFAULT_PREVIEW_LAYOUT_ID;
    }
  });

  function changePreviewLayout(id: PreviewLayoutId) {
    setPreviewLayout(id);
    try {
      window.localStorage.setItem(PREVIEW_LAYOUT_STORAGE_KEY, id);
    } catch {
      /* storage unavailable — the session choice still applies */
    }
  }

  // Bulk reassignment: selection is tracked by item id and pruned against
  // the live document, so deleted or filtered-out items never linger.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const presentIds = new Set(doc.categories.flatMap((c) => c.items.map((i) => i.id)));
  const selected = [...selectedIds].filter((id) => presentIds.has(id));

  function toggleSelected(itemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function handleBulkMove() {
    if (selected.length === 0 || !bulkTarget) return;
    onChange(moveItemsToCategory(doc, selected, bulkTarget));
    setSelectedIds(new Set());
    setBulkTarget("");
  }

  const headerRow = (
    <div data-print-hide className="flex items-center gap-3">
      <button type="button" onClick={onBack} className={smallButton}>
        ← All menus
      </button>
      {undoLabel && (
        <button
          type="button"
          onClick={handleUndo}
          className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:border-amber-700 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          ↩ Undo {undoLabel}
        </button>
      )}
      <p
        role="status"
        className={`text-xs font-medium ${saveState.kind === "error" ? "text-red-700" : "text-stone-500"}`}
      >
        {saveState.kind === "saving" ? (
          <span>
            <span
              aria-hidden="true"
              className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-stone-400 border-t-transparent align-[-2px]"
            />
            Saving…
          </span>
        ) : (
          saveState.message
        )}
      </p>
      <span className="flex-1" />
      <button
        type="button"
        aria-pressed={previewing}
        onClick={() => setPreviewing((value) => !value)}
        className={previewing ? primaryButton : smallButton}
      >
        {previewing ? "← Back to edit" : "Preview menu"}
      </button>
    </div>
  );

  if (previewing) {
    return (
      <div className="flex flex-col gap-4">
        {headerRow}
        <div
          data-print-hide
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white p-3"
        >
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Style</p>
          <div role="group" aria-label="Preview style" className="flex flex-wrap gap-1.5">
            {PREVIEW_THEME_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={previewThemeId === id}
                onClick={() => changePreviewTheme(id)}
                className={
                  previewThemeId === id
                    ? "rounded-full bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    : "rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                }
              >
                {PREVIEW_THEMES[id].name}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-5 w-px bg-stone-200 sm:block" aria-hidden="true" />
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Layout</p>
          <div role="group" aria-label="Preview layout" className="flex flex-wrap gap-1.5">
            {[
              { id: "list" as const, label: "List" },
              { id: "columns" as const, label: "Two columns" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={previewLayout === option.id}
                onClick={() => changePreviewLayout(option.id)}
                className={
                  previewLayout === option.id
                    ? "rounded-full bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    : "rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={() => window.print()} className={smallButton}>
            Print / save PDF
          </button>
        </div>
        <MenuPreview doc={doc} themeId={previewThemeId} layout={previewLayout} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {headerRow}

      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <CommitInput
            label="Menu title"
            value={doc.title}
            onCommit={(title) => onChange({ ...doc, title: title.trim() })}
          />
          <CommitInput
            label="Currency"
            value={doc.currency ?? ""}
            validate={() => null}
            placeholder="e.g. USD"
            onCommit={(currency) =>
              onChange({ ...doc, currency: currency.trim() ? currency.trim() : null })
            }
          />
        </div>
        {doc.source?.provider === "demo" && (
          <p className="mt-2 inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
            Demo data
          </p>
        )}
        {imageUrl && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-stone-500">Source image</p>
            <img
              src={imageUrl}
              alt="Original uploaded menu"
              className="max-h-28 w-auto rounded-lg border border-stone-200 object-contain"
            />
          </div>
        )}
        {reviewCount > 0 && (
          <p className="mt-2 text-xs font-medium text-amber-800">
            {reviewCount} {reviewCount === 1 ? "item needs" : "items need"} review.
          </p>
        )}
      </div>

      {duplicateGroups.length > 0 && (
        <section
          aria-label="Possible duplicates"
          className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">
            {duplicateGroups.length === 1
              ? "1 possible duplicate found — review it; nothing is deleted automatically."
              : `${duplicateGroups.length} possible duplicates found — review them; nothing is deleted automatically.`}
          </p>
          <ul className="mt-3 space-y-3">
            {duplicateGroups.map((group) => (
              <li key={group.key} className="rounded-xl border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-stone-900">
                    “{group.displayName}” appears {group.occurrences.length} times
                  </p>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => dismissGroup(group.key)}
                    className={smallButton}
                  >
                    Keep all
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {group.occurrences.map((occurrence) => (
                    <li
                      key={occurrence.item.id}
                      className="flex flex-wrap items-center gap-2 text-sm text-stone-700"
                    >
                      <span className="min-w-[160px] flex-1">
                        {occurrence.item.name}
                        <span className="text-xs text-stone-500">
                          {" "}
                          in {occurrence.categoryName}
                          {occurrence.item.price !== null &&
                            ` · ${occurrence.item.currency ?? doc.currency ?? ""}${occurrence.item.price}`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(occurrence.categoryId, occurrence.item)}
                        className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                      >
                        Delete this copy
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3">
        <label htmlFor="menu-search" className="sr-only">
          Search the menu
        </label>
        <input
          id="menu-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) setQuery("");
          }}
          placeholder="Search items, descriptions, or categories…"
          className="min-w-[200px] flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none"
        />
        {isFiltering && (
          <button type="button" onClick={() => setQuery("")} className={smallButton}>
            Clear
          </button>
        )}
        <p role="status" className="text-xs font-medium text-stone-500">
          {isFiltering
            ? `${search.matchCount} of ${search.totalItems} ${search.totalItems === 1 ? "item" : "items"}`
            : `${search.totalItems} ${search.totalItems === 1 ? "item" : "items"}`}
        </p>
      </div>

      {selected.length > 0 && (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3"
        >
          <p className="text-xs font-semibold text-amber-900">
            {selected.length} {selected.length === 1 ? "item" : "items"} selected
          </p>
          <label className="flex items-center gap-1.5 text-xs text-amber-900">
            Move to
            <select
              aria-label="Category to move selected items to"
              value={bulkTarget}
              onChange={(event) => setBulkTarget(event.target.value)}
              className="rounded-full border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
            >
              <option value="">Category…</option>
              {doc.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!bulkTarget}
            onClick={handleBulkMove}
            className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Move selected
          </button>
          <button type="button" onClick={() => setSelectedIds(new Set())} className={smallButton}>
            Clear
          </button>
        </div>
      )}

      {doc.categories.length > 0 && search.categories.length > 0 && (
        <div className="sticky top-0 z-20 -mx-4 flex items-center gap-3 bg-[#faf8f5]/95 px-4 py-2 backdrop-blur-sm">
          {viewMode === "single" && (
            <div
              role="navigation"
              aria-label="Menu categories"
              onKeyDown={handleChipListKeyDown}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1"
            >
              {search.categories.map(({ category, items }) => {
                const isActive = category.id === activeMatch?.category.id;
                return (
                  <button
                    key={category.id}
                    id={`category-chip-${category.id}`}
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    ref={isActive ? activeChipRef : null}
                    onClick={() => setActiveCategoryId(category.id)}
                    className={`shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 ${
                      isActive
                        ? "border-amber-800 bg-amber-800 text-white"
                        : "border-stone-300 bg-white text-stone-600 hover:border-amber-700 hover:text-amber-900"
                    }`}
                  >
                    {category.name}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 text-xs ${
                        isActive ? "bg-white/20" : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {items.length}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {viewMode === "all" && <span className="flex-1" />}
          <div
            role="group"
            aria-label="Category layout"
            className="flex shrink-0 rounded-full border border-stone-300 bg-white p-0.5"
          >
            <button
              type="button"
              aria-pressed={viewMode === "single"}
              onClick={() => changeViewMode("single")}
              className={viewModeButton(viewMode === "single")}
            >
              One at a time
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "all"}
              onClick={() => changeViewMode("all")}
              className={viewModeButton(viewMode === "all")}
            >
              All categories
            </button>
          </div>
        </div>
      )}

      {doc.categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">No categories yet</p>
          <p className="mt-1 text-sm text-stone-600">Add a category below, then add items to it.</p>
        </div>
      ) : search.categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">No items match “{query.trim()}”</p>
          <p className="mt-1 text-sm text-stone-600">
            {search.totalItems} {search.totalItems === 1 ? "item" : "items"} in this menu.
          </p>
          <button type="button" onClick={() => setQuery("")} className={`${smallButton} mt-3`}>
            Clear search
          </button>
        </div>
      ) : (
        search.categories
          .filter((match) => viewMode === "all" || match.category.id === activeMatch?.category.id)
          .map(({ category, items }) => {
            const index = doc.categories.findIndex((c) => c.id === category.id);
            return (
              <section
                key={category.id}
                aria-label={`Category ${category.name}`}
                className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4"
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <CommitInput
                    label={`Category ${index + 1}`}
                    value={category.name}
                    onCommit={(name) => onChange(renameCategory(doc, category.id, name.trim()))}
                  />
                  <div className="flex items-end gap-1.5 pb-0.5">
                    <button
                      type="button"
                      aria-label={`Move ${category.name} up`}
                      disabled={index === 0}
                      onClick={() => onChange(moveCategory(doc, category.id, index - 1))}
                      className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${category.name} down`}
                      disabled={index === doc.categories.length - 1}
                      onClick={() => onChange(moveCategory(doc, category.id, index + 1))}
                      className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(category, index)}
                      className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {items.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3 text-center text-sm text-stone-500">
                    No items — add the first one below.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {items.map((item) => (
                      <ItemEditor
                        key={item.id}
                        doc={doc}
                        categoryId={category.id}
                        item={item}
                        categories={doc.categories.map((c) => ({ id: c.id, name: c.name }))}
                        onChange={onChange}
                        onDelete={() => removeItem(category.id, item)}
                        duplicate={duplicateIds.has(item.id)}
                        selected={selectedIds.has(item.id)}
                        onToggle={() => toggleSelected(item.id)}
                      />
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => onChange(addItem(doc, category.id, { name: "New item" }))}
                  className={`${smallButton} mt-3`}
                >
                  + Add item
                </button>
              </section>
            );
          })
      )}

      <button
        type="button"
        onClick={handleAddCategory}
        className="rounded-2xl border-2 border-dashed border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
      >
        + Add category
      </button>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white p-4">
        <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Menu</span>
        <button type="button" onClick={onExportJson} className={smallButton}>
          Export JSON
        </button>
        <button type="button" onClick={onExportCsv} className={smallButton}>
          Export CSV
        </button>
        <label className={`${smallButton} cursor-pointer`}>
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportFile(file);
              event.target.value = "";
            }}
          />
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                `Delete “${doc.title}” permanently from this browser? Export a JSON backup first if it matters.`
              )
            ) {
              onDeleteMenu();
            }
          }}
          className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        >
          Delete menu
        </button>
      </div>
      {importError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {importError}
        </p>
      )}
      <p className="text-xs leading-5 text-stone-500">
        Menus are stored locally in this browser on this device — they don&apos;t follow you to
        other devices. Export JSON backups of anything important.
      </p>
    </div>
  );
}
