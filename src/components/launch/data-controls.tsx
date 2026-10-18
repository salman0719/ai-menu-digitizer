"use client";

/**
 * Export and delete, on the launch page (Step 11).
 *
 * Export is a plain JSON download of everything the account can see. Delete
 * requires typing the confirmation phrase, because it also removes the
 * restaurants the account created — menus, published pages, and order history
 * included — and there is no undo.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SyncError } from "@/features/menus/sync";
import { deleteAccount, downloadAccountExport } from "@/features/retention/client";
import { authClient } from "@/lib/auth-client";

const CONFIRM_PHRASE = "delete my account";

export function DataControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  function describeFailure(failure: unknown): string {
    if (failure instanceof SyncError) return failure.message;
    return failure instanceof Error ? failure.message : "Something went wrong. Try again.";
  }

  async function handleExport() {
    setBusy("export");
    setError(null);
    setMessage(null);
    try {
      await downloadAccountExport();
      setMessage("Your export downloaded as a JSON file.");
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    setError(null);
    setMessage(null);
    try {
      const result = await deleteAccount();
      setMessage(
        `Account deleted${result.restaurants > 0 ? `, along with ${result.restaurants} restaurant${result.restaurants === 1 ? "" : "s"}` : ""}.`
      );
      try {
        await authClient.signOut();
      } catch {
        // The session row is already gone with the user.
      }
      // Replace the history entry: the deleted account should not be one
      // "back" away, and the editor must re-render as signed out.
      router.replace("/");
      router.refresh();
    } catch (failure) {
      setError(describeFailure(failure));
      setBusy(null);
    }
  }

  return (
    <section id="data" className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-base font-semibold text-stone-900">Your data</h2>
      <p className="mt-1 text-sm text-stone-600">
        Download everything as JSON, or delete the account. Orders older than the retention window
        (90 days by default) are already removed automatically.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={busy !== null}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          {busy === "export" ? "Preparing…" : "Export my data"}
        </button>
        {confirming ? null : (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setError(null);
              setMessage(null);
            }}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Delete my account
          </button>
        )}
      </div>

      {confirming ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">
            This deletes the account, its restaurants, menus, published pages, and order history.
            Export first if you want a copy. There is no undo.
          </p>
          <label className="mt-2 block text-xs font-medium text-red-900">
            Type “{CONFIRM_PHRASE}” to confirm
            <input
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-red-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy !== null || confirmText.trim().toLowerCase() !== CONFIRM_PHRASE}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
            >
              {busy === "delete" ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setConfirmText("");
              }}
              className="rounded-lg px-2 py-1.5 text-sm text-stone-600 hover:text-stone-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
