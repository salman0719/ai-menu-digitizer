"use client";

import {
  duplicateItem,
  moveItem,
  moveItemToCategory,
  updateItem,
} from "@/features/menu/menu-utils";
import type { MenuDocument, MenuItem } from "@/features/menu/schema";

import { CommitInput, CommitNumber } from "./fields";

interface ItemEditorProps {
  doc: MenuDocument;
  isRouteTarget: boolean;
  onOpenItem: () => void;
  categoryId: string;
  item: MenuItem;
  /** All categories, for the move-to-another-category control. */
  categories: Array<{ id: string; name: string }>;
  onChange: (next: MenuDocument) => void;
  /** Request deletion of this item; the editor confirms and handles undo. */
  onDelete: () => void;
  /** Flagged by duplicate detection (review-only badge, see duplicates.ts). */
  duplicate: boolean;
  /** Bulk reassignment checkbox state (see menu-editor's bulk actions bar). */
  selected: boolean;
  onToggle: () => void;
}

const smallButton =
  "rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors " +
  "hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700";

export function ItemEditor({
  doc,
  categoryId,
  isRouteTarget,
  onOpenItem,
  item,
  categories,
  onChange,
  onDelete,
  duplicate,
  selected,
  onToggle,
}: ItemEditorProps) {
  const category = doc.categories.find((c) => c.id === categoryId);
  const index = category ? category.items.findIndex((i) => i.id === item.id) : -1;
  const needsReview = item.price === null || item.reviewNotes.length > 0;

  function patch(patch: Parameters<typeof updateItem>[3]) {
    onChange(updateItem(doc, categoryId, item.id, patch));
  }

  return (
    <li
      id={`menu-item-${item.id}`}
      className={`rounded-xl border bg-white p-4 ${isRouteTarget ? "border-amber-600 ring-2 ring-amber-200" : "border-stone-200"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-stone-100 pb-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900">
          {item.name || "Untitled item"}
        </p>
        <button
          type="button"
          onClick={onOpenItem}
          className="shrink-0 text-xs text-stone-500 underline hover:text-amber-900"
        >
          {isRouteTarget ? "Direct link selected" : "Link to item"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_90px]">
        <CommitInput
          label="Item name"
          value={item.name}
          onCommit={(name) => patch({ name: name.trim() })}
        />
        <CommitNumber
          label="Price"
          value={item.price}
          placeholder="Blank if unknown"
          onCommit={(price) => patch({ price })}
        />
        <CommitInput
          label="Currency"
          value={item.currency ?? ""}
          validate={() => null}
          placeholder="e.g. $"
          onCommit={(currency) => patch({ currency: currency.trim() ? currency.trim() : null })}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_170px]">
        <CommitInput
          label="Description"
          value={item.description ?? ""}
          validate={() => null}
          placeholder="Blank if none shown"
          multiline
          onCommit={(description) =>
            patch({ description: description.trim() ? description : null })
          }
        />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-stone-500">Availability</span>
          <select
            aria-label={`Availability of ${item.name}`}
            value={item.available === null ? "unknown" : item.available ? "yes" : "no"}
            onChange={(event) => {
              const v = event.target.value;
              patch({ available: v === "unknown" ? null : v === "yes" });
            }}
            className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
          >
            <option value="unknown">Unknown</option>
            <option value="yes">Available</option>
            <option value="no">Unavailable</option>
          </select>
        </label>
      </div>

      <div className="mt-3">
        <CommitInput
          label="Dietary labels (comma-separated, only if shown on the menu)"
          value={item.dietaryLabels.join(", ")}
          validate={() => null}
          placeholder="e.g. vegan, gluten-free"
          onCommit={(raw) =>
            patch({
              dietaryLabels: raw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <div className="mt-3 rounded-lg bg-stone-50 p-3">
        <p className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
          Variants / sizes
        </p>
        {item.variants.length === 0 && (
          <p className="mt-1 text-xs text-stone-500">None — add one if the menu shows sizes.</p>
        )}
        <ul className="mt-2 space-y-2">
          {item.variants.map((variant, vIndex) => (
            <li
              key={`${variant.name}-${vIndex}`}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_110px_auto]"
            >
              <CommitInput
                label={vIndex === 0 ? "Name" : `Variant ${vIndex + 1}`}
                value={variant.name}
                onCommit={(name) =>
                  patch({
                    variants: item.variants.map((v, i) =>
                      i === vIndex ? { ...v, name: name.trim() } : v
                    ),
                  })
                }
              />
              <CommitNumber
                label="Price"
                value={variant.price}
                onCommit={(price) =>
                  patch({
                    variants: item.variants.map((v, i) => (i === vIndex ? { ...v, price } : v)),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove variant ${variant.name}`}
                onClick={() => patch({ variants: item.variants.filter((_, i) => i !== vIndex) })}
                className={smallButton}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => patch({ variants: [...item.variants, { name: "New size", price: null }] })}
          className={`${smallButton} mt-2`}
        >
          + Add variant
        </button>
      </div>

      <div className="mt-3 rounded-lg bg-stone-50 p-3">
        <p className="text-xs font-semibold tracking-wide text-stone-600 uppercase">
          Options / add-ons
        </p>
        {item.options.length === 0 && (
          <p className="mt-1 text-xs text-stone-500">
            None — add a group if the menu shows choices.
          </p>
        )}
        <ul className="mt-2 space-y-3">
          {item.options.map((option, oIndex) => (
            <li
              key={`${option.name}-${oIndex}`}
              className="rounded-lg border border-stone-200 bg-white p-2.5"
            >
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <CommitInput
                  label="Option group"
                  value={option.name}
                  onCommit={(name) =>
                    patch({
                      options: item.options.map((o, i) =>
                        i === oIndex ? { ...o, name: name.trim() } : o
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove option group ${option.name}`}
                  onClick={() => patch({ options: item.options.filter((_, i) => i !== oIndex) })}
                  className={smallButton}
                >
                  ✕
                </button>
              </div>
              <ul className="mt-2 space-y-2">
                {option.choices.map((choice, cIndex) => (
                  <li
                    key={`${choice.name}-${cIndex}`}
                    className="grid grid-cols-1 items-end gap-2 pl-3 sm:grid-cols-[1fr_110px_auto]"
                  >
                    <CommitInput
                      label="Choice"
                      value={choice.name}
                      onCommit={(name) =>
                        patch({
                          options: item.options.map((o, i) =>
                            i === oIndex
                              ? {
                                  ...o,
                                  choices: o.choices.map((c, j) =>
                                    j === cIndex ? { ...c, name: name.trim() } : c
                                  ),
                                }
                              : o
                          ),
                        })
                      }
                    />
                    <CommitNumber
                      label="Extra"
                      value={choice.priceDelta}
                      onCommit={(priceDelta) =>
                        patch({
                          options: item.options.map((o, i) =>
                            i === oIndex
                              ? {
                                  ...o,
                                  choices: o.choices.map((c, j) =>
                                    j === cIndex ? { ...c, priceDelta } : c
                                  ),
                                }
                              : o
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove choice ${choice.name}`}
                      onClick={() =>
                        patch({
                          options: item.options.map((o, i) =>
                            i === oIndex
                              ? { ...o, choices: o.choices.filter((_, j) => j !== cIndex) }
                              : o
                          ),
                        })
                      }
                      className={smallButton}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  patch({
                    options: item.options.map((o, i) =>
                      i === oIndex
                        ? {
                            ...o,
                            choices: [...o.choices, { name: "New choice", priceDelta: null }],
                          }
                        : o
                    ),
                  })
                }
                className={`${smallButton} mt-2`}
              >
                + Add choice
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => patch({ options: [...item.options, { name: "New option", choices: [] }] })}
          className={`${smallButton} mt-2`}
        >
          + Add option group
        </button>
      </div>

      {item.reviewNotes.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 rounded-lg bg-amber-50 p-3 pl-8 text-xs text-amber-900">
          {item.reviewNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${item.name} for bulk move`}
            className="h-4 w-4 rounded border-stone-300 accent-amber-700"
          />
          Select for bulk move
        </label>
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => onChange(moveItem(doc, categoryId, item.id, index - 1))}
          className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          ↑ Move up
        </button>
        <button
          type="button"
          disabled={category === undefined || index === -1 || index >= category.items.length - 1}
          onClick={() => onChange(moveItem(doc, categoryId, item.id, index + 1))}
          className={`${smallButton} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          ↓ Move down
        </button>
        {categories.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            Move to
            <select
              aria-label={`Move ${item.name} to another category`}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) {
                  onChange(moveItemToCategory(doc, categoryId, event.target.value, item.id));
                  event.target.value = "";
                }
              }}
              className="rounded-full border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
            >
              <option value="">Category…</option>
              {categories
                .filter((c) => c.id !== categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <span className="flex-1" />
        {needsReview && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
            Needs review
          </span>
        )}
        {duplicate && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-900">
            Possible duplicate
          </span>
        )}
        <button
          type="button"
          onClick={() => onChange(duplicateItem(doc, categoryId, item.id))}
          className={smallButton}
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
