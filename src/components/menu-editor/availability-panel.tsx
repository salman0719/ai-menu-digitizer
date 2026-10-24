"use client";

/**
 * Opening-times editor (Step 4b): when this menu is "open" on the table
 * landing (`/r/<slug>/t/<table>`).
 *
 * Empty means always open — the default. Each row is weekdays plus a
 * half-open [start, end) range; an end at or before the start crosses
 * midnight into the next day. Changes take effect on the table page right
 * away — no republish needed — because the landing reads the menu row, not
 * a snapshot.
 *
 * Self-loading: the panel fetches the current windows for `menuId` on
 * mount. Staff see a read-only summary; local-only menus get a muted note
 * since times only matter once the menu lives in an account.
 */

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  browserTimeZone,
  fetchAvailability,
  saveAvailability,
} from "@/features/availability/client";
import {
  menuAvailabilitySchema,
  type AvailabilityWindow,
  type MenuAvailability,
} from "@/features/availability/schema";
import { SyncError } from "@/features/menus/sync";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Every IANA zone the browser knows; engines without the API get plain text. */
const ZONE_CHOICES: string[] | null =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : null;

interface AvailabilityPanelProps {
  menuId: string;
  syncMode: "local" | "account";
  canManage?: boolean;
}

/** "Mon–Fri" / "Sun" / "Mon, Wed, Fri" / "Every day". */
function formatDays(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const runs: number[][] = [];
  for (const day of sorted) {
    const last = runs[runs.length - 1];
    if (last && day === last[last.length - 1] + 1) last.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) =>
      run.length === 1
        ? WEEKDAYS[run[0]]
        : run.length === 2
          ? `${WEEKDAYS[run[0]]}, ${WEEKDAYS[run[1]]}`
          : `${WEEKDAYS[run[0]]}–${WEEKDAYS[run[run.length - 1]]}`
    )
    .join(", ");
}

function formatWindow(window: AvailabilityWindow): string {
  const overnight = window.end <= window.start;
  return `${formatDays(window.days)} · ${window.start}–${window.end}${overnight ? " (overnight)" : ""}`;
}

function freshWindow(): AvailabilityWindow {
  return { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
}

export function AvailabilityPanel({ menuId, syncMode, canManage = true }: AvailabilityPanelProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    syncMode === "account" ? "loading" : "ready"
  );
  const [windows, setWindows] = useState<MenuAvailability>([]);
  const [draft, setDraft] = useState<MenuAvailability>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  /** The zone the stored hours are written in (null = never set: UTC). */
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [draftTimeZone, setDraftTimeZone] = useState<string | null>(null);

  // The parent keys this panel by menu id, so mount always means a fresh
  // menu: "loading" is the initial state, and the effect only settles the
  // fetch (never re-triggers a render synchronously).
  useEffect(() => {
    if (syncMode !== "account") return;
    let cancelled = false;
    fetchAvailability(menuId)
      .then((current) => {
        if (cancelled) return;
        setWindows(current.availability);
        setDraft(current.availability);
        setTimeZone(current.timeZone);
        setDraftTimeZone(current.timeZone ?? browserTimeZone());
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof SyncError ? error.message : "Could not load opening times.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [menuId, syncMode]);

  if (syncMode !== "account") {
    return (
      <section
        aria-label="Opening times"
        className="rounded-2xl border border-stone-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-stone-900">Opening times</h2>
        <p className="mt-1 text-xs leading-5 text-stone-600">
          Opening hours are set once this menu is on your account, because that is the version its
          table page shows. Get your public link first — until then the menu is served all day.
        </p>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section
        aria-label="Opening times"
        aria-busy="true"
        className="rounded-2xl border border-stone-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-stone-900">Opening times</h2>
        <div role="status" className="mt-2 flex flex-col gap-2">
          <span className="sr-only">Loading opening times…</span>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-4/5" />
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section
        aria-label="Opening times"
        className="rounded-2xl border border-stone-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-stone-900">Opening times</h2>
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
          {loadError ?? "Could not load opening times."}
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("loading");
            setLoadError(null);
            fetchAvailability(menuId)
              .then((current) => {
                setWindows(current.availability);
                setDraft(current.availability);
                setTimeZone(current.timeZone);
                setDraftTimeZone(current.timeZone ?? browserTimeZone());
                setStatus("ready");
              })
              .catch((error: unknown) => {
                setLoadError(
                  error instanceof SyncError ? error.message : "Could not load opening times."
                );
                setStatus("error");
              });
          }}
          className="mt-2 rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:border-amber-700 hover:text-amber-900"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!canManage) {
    return (
      <section
        aria-label="Opening times"
        className="rounded-2xl border border-stone-200 bg-white p-4"
      >
        <h2 className="text-sm font-bold text-stone-900">Opening times</h2>
        <p className="mt-1 text-xs text-stone-500">Times are in {timeZone ?? "UTC"}.</p>
        {windows.length === 0 ? (
          <p className="mt-1 text-xs text-stone-600">Always open — no restricted hours.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {windows.map((window, index) => (
              <li key={index} className="text-xs text-stone-700">
                {formatWindow(window)}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const validation = menuAvailabilitySchema.safeParse(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(windows) || draftTimeZone !== timeZone;

  function updateWindow(index: number, next: AvailabilityWindow) {
    setDraft((current) => current.map((window, i) => (i === index ? next : window)));
    setSaveError(null);
    setSavedTick(false);
  }

  async function handleSave() {
    if (!validation.success || !dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveAvailability(menuId, validation.data, draftTimeZone);
      setWindows(saved.availability);
      setDraft(saved.availability);
      setTimeZone(saved.timeZone);
      setDraftTimeZone(saved.timeZone);
      setSavedTick(true);
    } catch (error: unknown) {
      setSaveError(error instanceof SyncError ? error.message : "Could not save opening times.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label="Opening times"
      className="rounded-2xl border border-stone-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-bold text-stone-900">Opening times</h2>
        <p className="text-xs text-stone-500">
          {draft.length === 0
            ? "Always open — the table page shows this menu all day."
            : "Only these hours show on the table page. Takes effect right away, no republish needed."}
        </p>
      </div>

      <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
        Times are in
        {ZONE_CHOICES ? (
          <select
            value={draftTimeZone ?? "UTC"}
            onChange={(event) => {
              setDraftTimeZone(event.target.value === "UTC" ? null : event.target.value);
              setSaveError(null);
              setSavedTick(false);
            }}
            className="rounded-lg border border-stone-300 px-2 py-1 text-xs focus:border-amber-700 focus:outline-none"
          >
            <option value="UTC">UTC</option>
            {draftTimeZone && !ZONE_CHOICES.includes(draftTimeZone) && (
              <option value={draftTimeZone}>{draftTimeZone}</option>
            )}
            {ZONE_CHOICES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        ) : (
          <span>{draftTimeZone ?? "UTC"}</span>
        )}
        <span className="text-stone-400">
          — diners see the menu as open or closed in this zone.
        </span>
      </label>

      {draft.length > 0 && (
        <ul className="mt-3 space-y-3">
          {draft.map((window, index) => (
            <li key={index} className="rounded-xl border border-stone-200 p-3">
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={`Days for row ${index + 1}`}
              >
                {WEEKDAYS.map((label, day) => {
                  const on = window.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      title={label}
                      onClick={() => {
                        const days = on
                          ? window.days.filter((d) => d !== day)
                          : [...window.days, day].sort((a, b) => a - b);
                        updateWindow(index, { ...window, days });
                      }}
                      className={`h-8 w-8 rounded-full text-xs font-semibold transition-colors ${
                        on
                          ? "bg-amber-800 text-white"
                          : "border border-stone-300 text-stone-500 hover:border-amber-700 hover:text-amber-900"
                      }`}
                    >
                      {label[0]}
                    </button>
                  );
                })}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    setDraft((current) => current.filter((_, i) => i !== index));
                    setSaveError(null);
                    setSavedTick(false);
                  }}
                  className="text-xs font-medium text-stone-500 underline hover:text-red-800"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs text-stone-600">
                  Opens{" "}
                  <input
                    type="time"
                    value={window.start}
                    onChange={(event) =>
                      updateWindow(index, { ...window, start: event.target.value })
                    }
                    className="rounded-lg border border-stone-300 px-2 py-1 text-xs focus:border-amber-700 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-stone-600">
                  Closes{" "}
                  <input
                    type="time"
                    value={window.end}
                    onChange={(event) =>
                      updateWindow(index, { ...window, end: event.target.value })
                    }
                    className="rounded-lg border border-stone-300 px-2 py-1 text-xs focus:border-amber-700 focus:outline-none"
                  />
                </label>
                {window.end <= window.start && (
                  <span className="text-[11px] font-medium text-stone-500">runs past midnight</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!validation.success && (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {validation.error.issues[0]?.message ?? "Those hours are not valid."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft((current) => [...current, freshWindow()]);
            setSaveError(null);
            setSavedTick(false);
          }}
          disabled={draft.length >= 28}
          className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add hours
        </button>
        {draft.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraft([]);
              setSaveError(null);
              setSavedTick(false);
            }}
            className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900"
          >
            Always open
          </button>
        )}
        <span className="flex-1" />
        {savedTick && !dirty && (
          <span role="status" className="text-xs font-medium text-green-800">
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || !validation.success || saving}
          className="rounded-full bg-amber-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save hours"}
        </button>
      </div>

      {saveError && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
          {saveError}
        </p>
      )}
    </section>
  );
}
