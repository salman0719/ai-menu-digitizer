"use client";

/**
 * "Changed elsewhere" banner (PHASE-2.md §4 P2-3). Shown when a server push
 * loses the updatedAt race: the editor keeps the user's edits locally and
 * asks for an explicit decision instead of silently overwriting either side.
 */

interface ConflictBannerProps {
  /** The server's current updatedAt; null means the server copy is gone. */
  serverUpdatedAt: string | null;
  /** Error from the last resolution attempt, if any. */
  error: string | null;
  /** Adopt the server version (discards local edits — explicit action). */
  onReloadServer: () => void;
  /** Push the local version over the server one (explicit overwrite). */
  onKeepMine: () => void;
}

export function ConflictBanner({
  serverUpdatedAt,
  error,
  onReloadServer,
  onKeepMine,
}: ConflictBannerProps) {
  return (
    <div
      role="alert"
      data-print-hide
      className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4"
    >
      <p className="font-medium text-amber-900">This menu was changed elsewhere</p>
      <p className="mt-1 text-sm leading-6 text-amber-800">
        Another tab or device saved a newer version while you were editing. Your edits are safe in
        this browser — choose which version wins.
      </p>
      {error && <p className="mt-2 text-sm text-red-800">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReloadServer}
          className="rounded-full bg-amber-800 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"
        >
          Load the server version
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={serverUpdatedAt === null}
          className="rounded-full border border-amber-700 px-4 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Keep my version
        </button>
      </div>
      {serverUpdatedAt === null && (
        <p className="mt-2 text-xs text-amber-800">
          The server copy no longer exists, so there is nothing to overwrite — keep your version,
          or re-run “Move my menus to my account” from the library.
        </p>
      )}
    </div>
  );
}
