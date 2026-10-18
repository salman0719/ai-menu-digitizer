"use client";

import type { MenuSummary } from "@/features/menu/storage";

import { CommitInput } from "./fields";

/** A library row: the local summary plus whether the account holds a copy. */
export interface LibraryMenu extends MenuSummary {
  onServer: boolean;
}

interface LibraryPanelProps {
  menus: LibraryMenu[];
  /** Signed in: every row carries an account-status chip. */
  accountMode: boolean;
  activeId: string | null;
  unavailable: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  if (!iso) return "unknown date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toLocaleString();
}

export function LibraryPanel({
  menus,
  accountMode,
  activeId,
  unavailable,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: LibraryPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-stone-900">My menus</h2>
        <button
          type="button"
          onClick={onNew}
          disabled={unavailable}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          + New menu
        </button>
      </div>

      {unavailable && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          Browser storage isn&apos;t available, so menus can&apos;t be saved here. You can still
          extract and export, but everything will be lost on refresh.
        </p>
      )}

      {menus.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">No saved menus yet</p>
          <p className="mt-1 text-sm text-stone-600">
            Extract a menu or start a blank one — it will appear here and survive refreshes.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {menus.map((menu) => (
            <li
              key={menu.id}
              className={`rounded-2xl border bg-white p-4 ${menu.id === activeId ? "border-amber-600" : "border-stone-200"}`}
            >
              {menu.corrupt ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-stone-900">Unreadable record</p>
                    <p className="text-xs text-stone-500">
                      Damaged or from an incompatible version — it can only be deleted.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Delete this unreadable record?")) onDelete(menu.id);
                    }}
                    className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CommitInput
                      label={`Rename menu ${menu.title}`}
                      value={menu.title}
                      onCommit={(title) => onRename(menu.id, title.trim())}
                    />
                    <p className="mt-1 text-xs text-stone-500">
                      {menu.categoryCount} {menu.categoryCount === 1 ? "category" : "categories"} ·{" "}
                      {menu.itemCount} {menu.itemCount === 1 ? "item" : "items"} · updated{" "}
                      {formatDate(menu.updatedAt)}{" "}
                      {accountMode && (
                        <span
                          className={
                            menu.onServer
                              ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900"
                              : "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                          }
                        >
                          {menu.onServer ? "On your account" : "This browser only"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(menu.id)}
                      className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete “${menu.title}” permanently? Export a JSON backup first if it matters.`
                          )
                        ) {
                          onDelete(menu.id);
                        }
                      }}
                      className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
