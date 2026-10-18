"use client";

import { authClient } from "@/lib/auth-client";

/**
 * App header. Also the app's one visible storage-mode indicator (PHASE-2.md
 * §4 risk table): signed out = "Local mode" (menus live in this browser),
 * signed in = menus sync to the account.
 */
export function SiteHeader() {
  const { data, isPending } = authClient.useSession();
  const user = data?.user ?? null;

  return (
    <header data-print-hide className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-700 text-base font-bold text-white"
          >
            T
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-stone-900">Tablepass</p>
            <p className="text-xs text-stone-500">Menus, tables, and orders in one place</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isPending ? null : user ? (
            <>
              <span className="hidden text-[11px] text-stone-500 sm:inline" title={user.email}>
                Syncing to {user.email}
              </span>
              <button
                type="button"
                onClick={() => void authClient.signOut()}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <span className="hidden text-[11px] text-stone-400 sm:inline">Local mode</span>
              <a
                href="/sign-in"
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              >
                Sign in
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
