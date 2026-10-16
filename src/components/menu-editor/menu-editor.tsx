"use client";

import { useState } from "react";

import {
  addCategory,
  addItem,
  deleteCategory,
  deleteItem,
  moveCategory,
  renameCategory,
} from "@/features/menu/menu-utils";
import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import {
  canRestoreDeleteUndo,
  captureDeleteUndo,
  restoreDeleteUndo,
  type DeleteUndo,
} from "@/features/menu/undo";

import { CommitInput } from "./fields";
import { ItemEditor } from "./item-editor";

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
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
      </div>

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

      {doc.categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">No categories yet</p>
          <p className="mt-1 text-sm text-stone-600">Add a category below, then add items to it.</p>
        </div>
      ) : (
        doc.categories.map((category, index) => (
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
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete category “${category.name}” and its ${category.items.length} items? You can undo this until your next change.`
                      )
                    ) {
                      const next = deleteCategory(doc, category.id);
                      setUndo(
                        captureDeleteUndo(doc, next, `deleted category “${category.name}”`)
                      );
                      onChange(next);
                    }
                  }}
                  className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
            {category.items.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-3 text-center text-sm text-stone-500">
                No items — add the first one below.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {category.items.map((item) => (
                  <ItemEditor
                    key={item.id}
                    doc={doc}
                    categoryId={category.id}
                    item={item}
                    categories={doc.categories.map((c) => ({ id: c.id, name: c.name }))}
                    onChange={onChange}
                    onDelete={() => removeItem(category.id, item)}
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
        ))
      )}

      <button
        type="button"
        onClick={() => onChange(addCategory(doc, { name: "New category" }))}
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
