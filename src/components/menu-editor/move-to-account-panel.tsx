"use client";

import { useEffect, useState } from "react";

import { moveLocalMenusToAccount, type MoveReport } from "@/features/menus/move-to-account";
import {
  createRestaurant,
  fetchRestaurants,
  type RestaurantOption,
} from "@/features/tenancy/client";

/**
 * "Move my menus to my account" (PHASE-2.md §3.4). Shown in the library for
 * signed-in users: pick a restaurant you own, then copy every local menu into
 * it through the validated API. One-way — local copies are never deleted —
 * and idempotent, so re-running only reports what was already there.
 */

interface MoveToAccountPanelProps {
  /** How many local-only menus the move would consider (for the button label). */
  menuCount: number;
  /** Called after a run that imported at least one menu (refresh the library). */
  onMoved?: () => void;
}

export function MoveToAccountPanel({ menuCount, onMoved }: MoveToAccountPanelProps) {
  const [restaurants, setRestaurants] = useState<RestaurantOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MoveReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (cancelled) return;
        setRestaurants(list);
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
  }, []);

  const owned = restaurants?.filter((r) => r.role === "owner") ?? [];
  const staffOnly = restaurants !== null && owned.length === 0 && restaurants.length > 0;

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createRestaurant(name);
      setRestaurants((prev) => [...(prev ?? []), created]);
      setSelectedId(created.id);
      setNewName("");
    } catch {
      setError("Could not create the restaurant. Check your connection and try again.");
    } finally {
      setCreating(false);
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
      // here means even reading the local library failed.
      setError(
        moveError instanceof Error
          ? moveError.message
          : "Could not read your local menus. Try refreshing the page."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-sm font-bold tracking-tight text-stone-900">
        Move my menus to my account
      </h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        Copies your {menuCount === 1 ? "locally saved menu" : `${menuCount} locally saved menus`}
        {""} into your account so other devices see them too. This browser keeps its copies —
        nothing is deleted.
      </p>

      {loadError && <p className="mt-2 text-xs text-red-700">{loadError}</p>}

      {restaurants === null && !loadError && (
        <p role="status" className="mt-2 text-xs text-stone-400">
          Loading your restaurants…
        </p>
      )}

      {staffOnly && (
        <p className="mt-2 text-xs text-amber-800">
          You are only a staff member of the restaurants on this account. Only an owner can add
          menus — ask the owner to run this from their sign-in.
        </p>
      )}

      {restaurants !== null && owned.length === 0 && !staffOnly && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
            Name your restaurant
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
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
      )}

      {owned.length > 0 && !report && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-stone-600">
            Move into
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
            {busy ? "Moving…" : `Move ${menuCount === 1 ? "1 menu" : `${menuCount} menus`}`}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {report && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <p className="text-sm font-medium text-stone-900">
            Moved {report.imported.length} · already in your account {report.skipped.length} ·
            failed {report.failed.length}
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
