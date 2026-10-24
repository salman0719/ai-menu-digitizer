"use client";

import { useState } from "react";

import type { RestaurantOption } from "@/features/tenancy/client";

/**
 * The two post-sign-in surfaces for menus that live only in this browser:
 * a one-click offer for an established account, and the notice after an
 * automatic import for a brand-new one. Neither claims that a menu is on
 * another device before the server has accepted it.
 */

export interface LocalDraftClaimNotice {
  /** Menus the server accepted in this run. */
  imported: number;
  /** Menus that could not be imported (already reported per menu by name). */
  failed: number;
  restaurantName: string;
}

function menuCountLabel(count: number): string {
  return count === 1 ? "1 menu" : `${count} menus`;
}

export function LocalDraftsOffer({
  count,
  restaurants,
  busy,
  onAdd,
  onDismiss,
}: {
  count: number;
  /** Owned restaurants; the caller only renders this when at least one exists. */
  restaurants: RestaurantOption[];
  busy: boolean;
  onAdd: (restaurantId: string) => void;
  onDismiss: () => void;
}) {
  const [targetId, setTargetId] = useState(restaurants[0]?.id ?? "");
  const target = restaurants.find((restaurant) => restaurant.id === targetId) ?? restaurants[0];

  return (
    <section
      aria-label="Menus from this browser"
      className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            From this browser
          </p>
          <p className="mt-1 text-sm font-semibold text-amber-950">
            We found {menuCountLabel(count)} saved here.
          </p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-amber-900">
            Add {count === 1 ? "it" : "them"} to your account so other devices and your public link
            can use {count === 1 ? "it" : "them"}. This browser keeps its copies.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {restaurants.length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-medium text-amber-900">
              Add to
              <select
                value={target?.id ?? ""}
                onChange={(event) => setTargetId(event.target.value)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                {restaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              if (target) onAdd(target.id);
            }}
            disabled={busy || !target}
            className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            {busy ? "Adding…" : count === 1 ? "Add to account" : `Add all ${count} to account`}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:border-amber-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}

export function LocalDraftsNotice({
  notice,
  onOpenLibrary,
  onDismiss,
}: {
  notice: LocalDraftClaimNotice;
  onOpenLibrary: () => void;
  onDismiss: () => void;
}) {
  const nothingImported = notice.imported === 0 && notice.failed === 0;

  return (
    <section
      role="status"
      aria-label="Menus from this browser"
      className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-950">
            {nothingImported
              ? "Those browser menus are already on your account"
              : `Added ${menuCountLabel(notice.imported)} from this browser`}
          </p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-emerald-900">
            {nothingImported
              ? `“${notice.restaurantName}” already holds them. This browser keeps a copy too.`
              : `They live under “${notice.restaurantName}” and work on your other devices. This browser keeps a copy.`}
          </p>
          {notice.failed > 0 && (
            <p className="mt-1 text-xs font-medium leading-5 text-amber-900">
              {menuCountLabel(notice.failed)} could not be added. Open My menus and use “Import from
              this browser” to try again.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onOpenLibrary}
            className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 transition-colors hover:border-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            Open My menus
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-medium text-emerald-900 underline underline-offset-2 hover:text-emerald-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
