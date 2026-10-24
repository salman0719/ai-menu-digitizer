"use client";

/**
 * Order alerts preference (R0.4, owner-only). One email per new order,
 * on by default; blanking the address sends to the owners' account emails
 * instead. A rush never spams the inbox — past a few emails in ten minutes
 * only the board and the in-app monitor catch the rest.
 */

import { useEffect, useState } from "react";

import { SyncError } from "@/features/menus/sync";
import { fetchAlertPrefs, updateAlertPrefs } from "@/features/tenancy/client";

function describeFailure(failure: unknown): string {
  if (failure instanceof SyncError) return failure.message;
  return failure instanceof Error ? failure.message : "Something went wrong. Try again.";
}

export function OrderAlertsCard({
  restaurantId,
  restaurantName,
}: {
  restaurantId: string;
  restaurantName: string;
}) {
  const [enabled, setEnabled] = useState(true);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const prefs = await fetchAlertPrefs(restaurantId);
        if (cancelled) return;
        setEnabled(prefs.enabled);
        setEmail(prefs.email ?? "");
      } catch (failure) {
        if (!cancelled) setError(describeFailure(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateAlertPrefs(restaurantId, { enabled, email: email.trim() });
      setEnabled(saved.enabled);
      setEmail(saved.email ?? "");
      setNotice(
        saved.enabled
          ? `New orders will email ${saved.email ?? "every owner"}.`
          : "New-order emails are off — the board and the app badge still catch everything."
      );
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-sm font-bold tracking-tight text-stone-900">Order alerts</h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        One email per new order for {restaurantName}, from the verified Eateryo sender. A rush
        never spams the inbox — past a few emails in ten minutes only the board catches the rest.
      </p>

      {loading ? (
        <p role="status" className="mt-3 text-xs text-stone-500">
          Loading the alert settings…
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm font-medium text-stone-900">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-amber-700"
            />
            Email me on every new order
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
            Send to
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Blank means every owner"
              autoComplete="email"
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            />
          </label>
          <p className="-mt-1 text-[11px] leading-4 text-stone-400">
            Blank sends to every owner&apos;s account email — fill it to route orders to one
            address instead (the till, a manager…).
          </p>
          <div>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              {saving ? "Saving…" : "Save alerts"}
            </button>
          </div>
          {notice && !error && <p className="text-xs text-emerald-800">{notice}</p>}
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
