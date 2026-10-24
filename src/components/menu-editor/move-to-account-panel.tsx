"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { moveLocalMenusToAccount, type MoveReport } from "@/features/menus/move-to-account";
import {
  createRestaurant,
  deleteRestaurant,
  fetchRestaurants,
  renameRestaurant,
  type RestaurantOption,
} from "@/features/tenancy/client";

/**
 * "Import from this browser": the manual fallback for menus saved here.
 * Demoted under My menus for R1: the common case is now claimed by the
 * post-sign-in offer or imported automatically for a brand-new account, and
 * this panel is the honest retry path for partial failures.
 *
 * Pick a restaurant you own, then copy every local menu into it through the
 * validated API. One-way — local copies are never deleted — and idempotent,
 * so re-running only reports what was already there. Owners can also rename
 * or delete the selected restaurant (delete cascades its menus, published
 * pages and orders server-side, so it warns first).
 *
 * Individual rows carry their own "Add to account" action in the library;
 * `onOwnedChange` keeps that action's target list in step with the
 * restaurants created, renamed, or deleted here.
 */

interface MoveToAccountPanelProps {
  /** How many browser-only menus the add would consider (button label). */
  menuCount: number;
  /** Name guessed from the local menu titles, to prefill the create field. */
  suggestedName?: string | null;
  /** Called after a run that imported at least one menu (refresh the library). */
  onMoved?: () => void;
  /** The owned restaurants, mirrored up for the per-row add action. */
  onOwnedChange?: (owned: RestaurantOption[]) => void;
}

export function MoveToAccountPanel({
  menuCount,
  suggestedName,
  onMoved,
  onOwnedChange,
}: MoveToAccountPanelProps) {
  const [restaurants, setRestaurants] = useState<RestaurantOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  /** The create field's value: the suggestion from the menu titles until the user types. */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const newName = nameDraft ?? suggestedName ?? "";
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MoveReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (cancelled) return;
        setRestaurants(list);
        onOwnedChange?.(list.filter((r) => r.role === "owner"));
        const owners = list.filter((r) => r.role === "owner");
        if (owners.length === 1 && owners[0]) setSelectedId(owners[0].id);
      } catch {
        if (!cancelled) {
          setLoadError("Could not load your restaurants. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onOwnedChange]);

  const owned = restaurants?.filter((r) => r.role === "owner") ?? [];
  const staffOnly = restaurants !== null && owned.length === 0 && restaurants.length > 0;
  const selected = owned.find((r) => r.id === selectedId) ?? null;

  /** Mirror the owned restaurants up for the per-row add action. */
  function publishOwned(list: RestaurantOption[]) {
    onOwnedChange?.(list.filter((restaurant) => restaurant.role === "owner"));
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createRestaurant(name);
      const next = [...(restaurants ?? []), created];
      setRestaurants(next);
      publishOwned(next);
      setSelectedId(created.id);
      setNameDraft(null);
    } catch {
      setError("Could not create the restaurant. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  function startRename() {
    if (!selected) return;
    setRenameDraft(selected.name);
    setRenaming(true);
  }

  async function handleRename() {
    const name = renameDraft.trim();
    if (!selected || !name || mutating) return;
    setMutating(true);
    setError(null);
    try {
      const updated = await renameRestaurant(selected.id, name);
      const next = (restaurants ?? []).map((r) => (r.id === updated.id ? updated : r));
      setRestaurants(next);
      publishOwned(next);
      setRenaming(false);
    } catch {
      setError("Could not rename the restaurant. Check your connection and try again.");
    } finally {
      setMutating(false);
    }
  }

  async function handleDelete() {
    if (!selected || mutating) return;
    if (
      !window.confirm(
        `Delete “${selected.name}” permanently? Its menus, published pages and orders are deleted too. This cannot be undone.`
      )
    ) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      await deleteRestaurant(selected.id);
      const next = (restaurants ?? []).filter((r) => r.id !== selected.id);
      setRestaurants(next);
      publishOwned(next);
      setSelectedId("");
      setRenaming(false);
    } catch {
      setError("Could not delete the restaurant. Check your connection and try again.");
    } finally {
      setMutating(false);
    }
  }

  async function handleMove() {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = await moveLocalMenusToAccount(selectedId);
      setReport(result);
      if (result.imported.length > 0) onMoved?.();
    } catch (moveError) {
      // moveLocalMenusToAccount reports per-menu failures itself; a throw
      // here means even reading the browser library failed.
      setError(
        moveError instanceof Error
          ? moveError.message
          : "Could not read the menus saved in this browser. Try refreshing the page."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white p-4 sm:p-5">
      <h3 className="text-sm font-bold tracking-tight text-stone-900">
        Menus saved in this browser
      </h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        Adds your {menuCount === 1 ? "saved menu" : `${menuCount} saved menus`} to your account so
        other devices see {menuCount === 1 ? "it" : "them"} too. This browser keeps its copies —
        nothing is deleted.
      </p>

      {loadError && <p className="mt-2 text-xs text-red-700">{loadError}</p>}

      {restaurants === null && !loadError && (
        <div role="status" aria-busy="true" className="mt-3">
          <span className="sr-only">Loading your restaurants…</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
        </div>
      )}

      {staffOnly && (
        <p className="mt-2 text-xs text-amber-800">
          You are only a staff member of the restaurants on this account. Only an owner can add
          menus — ask the owner to run this from their sign-in.
        </p>
      )}

      {restaurants !== null && owned.length === 0 && !staffOnly && (
        <div className="mt-3">
          {/* The hint sits below the row (not inside the label): with
              `items-end` an extra label line would drag the button down
              past the input's bottom edge and out of alignment. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
              Name your restaurant
              <input
                type="text"
                value={newName}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="e.g. Sunny Side Café"
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || newName.trim().length === 0}
              className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {creating ? "Creating…" : "Create restaurant"}
            </button>
          </div>
          {suggestedName && nameDraft === null && (
            <p className="mt-1 text-xs font-normal text-stone-400">
              Suggested from your menu titles — change it if you like.
            </p>
          )}
        </div>
      )}

      {owned.length > 0 && !report && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
            Add to
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <option value="" disabled>
                Choose a restaurant…
              </option>
              {owned.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleMove()}
            disabled={busy || !selectedId}
            className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            {busy ? "Adding…" : `Add ${menuCount === 1 ? "1 menu" : `${menuCount} menus`}`}
          </button>
        </div>
      )}

      {owned.length > 0 && !report && selected && !renaming && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={startRename}
            disabled={mutating}
            className="text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Rename “{selected.name}”
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={mutating}
            className="text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Delete…
          </button>
        </div>
      )}

      {owned.length > 0 && !report && selected && renaming && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
            Rename “{selected.name}”
            <input
              type="text"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleRename();
                if (event.key === "Escape") setRenaming(false);
              }}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleRename()}
              disabled={mutating || renameDraft.trim().length === 0}
              className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {mutating ? "Saving…" : "Save name"}
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              disabled={mutating}
              className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-600 transition-colors hover:border-stone-400 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <p className="text-sm font-medium text-stone-900">
            Added {report.imported.length} · already there {report.skipped.length} · failed{" "}
            {report.failed.length}
          </p>
          {report.failed.length > 0 && (
            <ul className="mt-2 space-y-1">
              {report.failed.map((failure) => (
                <li key={failure.id} className="text-xs text-red-800">
                  “{failure.title}”: {failure.reason}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setReport(null)}
            className="mt-2 text-xs font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
