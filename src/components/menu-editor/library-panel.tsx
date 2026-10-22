"use client";

import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { MenuSummary } from "@/features/menu/storage";
import type { RestaurantOption } from "@/features/tenancy/client";

import { CommitInput } from "./fields";

/** A library row: the local summary plus whether the account holds a copy. */
export interface LibraryMenu extends MenuSummary {
  onServer: boolean;
}

interface LibraryPanelProps {
  menus: LibraryMenu[];
  /** True until the first library read settles — rows skeleton, never the empty state. */
  loading?: boolean;
  /** Signed in: every row carries an account-status chip. */
  accountMode: boolean;
  /** Restaurants the caller owns — where a per-row move can put a menu. */
  ownedRestaurants?: RestaurantOption[];
  /**
   * Move one browser-only menu into a restaurant. Resolves to a message to
   * show on that row, or null when the move succeeded (or was already there).
   */
  onMoveToAccount?: (menuId: string, restaurantId: string) => Promise<string | null>;
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
  loading = false,
  accountMode,
  ownedRestaurants = [],
  onMoveToAccount,
  unavailable,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: LibraryPanelProps) {
  /** The row whose restaurant picker is open (one move at a time). */
  const [pickerMenuId, setPickerMenuId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);
  const moveAvailable = onMoveToAccount != null && ownedRestaurants.length > 0;

  function startMove(id: string) {
    setMoveError(null);
    const only = ownedRestaurants.length === 1 ? ownedRestaurants[0] : undefined;
    if (only) {
      // One restaurant means no choice to make: move straight away.
      setTargetId(only.id);
      void runMove(id, only.id);
      return;
    }
    setTargetId("");
    setPickerMenuId(id);
  }

  async function runMove(id: string, restaurantId: string) {
    if (!restaurantId || !onMoveToAccount || movingId !== null) return;
    setMovingId(id);
    setMoveError(null);
    try {
      const message = await onMoveToAccount(id, restaurantId);
      if (message) setMoveError({ id, message });
      else setPickerMenuId(null);
    } catch {
      setMoveError({
        id,
        message: "Could not move that menu. Check your connection and try again.",
      });
    } finally {
      setMovingId(null);
    }
  }

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

      {loading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading your menus…</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-5 w-2/5" />
                  <Skeleton className="mt-2 h-3 w-3/5" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-16 rounded-full" />
                  <Skeleton className="h-8 w-20 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : menus.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">No saved menus yet</p>
          <p className="mt-1 text-sm text-stone-600">
            Extract a menu or start a blank one — it will appear here and survive refreshes.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {menus.map((menu) => (
            <li key={menu.id} className="rounded-2xl border border-stone-200 bg-white p-4">
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
                      label={`Rename menu “${menu.title}”`}
                      value={menu.title}
                      onCommit={(title) => onRename(menu.id, title.trim())}
                    />
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span>
                        {menu.categoryCount} {menu.categoryCount === 1 ? "category" : "categories"} ·{" "}
                        {menu.itemCount} {menu.itemCount === 1 ? "item" : "items"} · updated{" "}
                        {formatDate(menu.updatedAt)}
                      </span>
                      {accountMode && (
                        <span
                          className={
                            menu.onServer
                              ? "whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900"
                              : "whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                          }
                        >
                          {menu.onServer ? "On your account" : "This browser only"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!menu.onServer && moveAvailable && (
                      <button
                        type="button"
                        onClick={() => startMove(menu.id)}
                        disabled={movingId !== null}
                        className="rounded-full border border-amber-700 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                      >
                        {movingId === menu.id ? "Moving…" : "Move to account"}
                      </button>
                    )}
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
              {pickerMenuId === menu.id && (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 sm:flex-row sm:items-end">
                  <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
                    Move “{menu.title}” into
                    <select
                      value={targetId}
                      onChange={(event) => setTargetId(event.target.value)}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      <option value="" disabled>
                        Choose a restaurant…
                      </option>
                      {ownedRestaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>
                          {restaurant.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runMove(menu.id, targetId)}
                      disabled={!targetId || movingId !== null}
                      className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      {movingId === menu.id ? "Moving…" : "Move"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickerMenuId(null)}
                      disabled={movingId !== null}
                      className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {moveError?.id === menu.id && (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  {moveError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
