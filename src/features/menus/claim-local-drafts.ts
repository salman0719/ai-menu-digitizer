/**
 * Claiming the drafts that exist only in this browser (R1).
 *
 * After sign-in, the account is the destination: a brand-new account (no
 * menus, no restaurants) gets its browser drafts imported in one go, while
 * an established account is *offered* the same import. Both paths use the
 * same one-way move helper, so the local copies are never deleted and a
 * re-run only reports what was already there.
 *
 * The decision is pure so it can be tested without a browser; only the
 * per-account "done / not now" memory touches localStorage, and it fails
 * quiet when storage is unavailable.
 */

export type LocalDraftClaimStatus = "unseen" | "dismissed" | "done";

export type LocalDraftClaimAction = "auto-import" | "offer" | "none";

export interface LocalDraftClaimInputs {
  /** Menus saved in this browser that the account does not hold yet. */
  localCount: number;
  /** Menus the signed-in account already holds on the server. */
  accountMenuCount: number;
  /** Restaurants the caller belongs to, in any role. */
  restaurantCount: number;
  /** Restaurants the caller owns (only owners can import menus). */
  ownedRestaurantCount: number;
  /** This account's remembered answer, if any. */
  status: LocalDraftClaimStatus;
  /**
   * True when this browser was last used by this account (or by none yet).
   * Another account's cached menus must never be swept into a new one.
   */
  accountSeenInBrowser: boolean;
}

/**
 * Brand-new accounts import automatically — there is no existing account
 * content to surprise anyone with. Established accounts get a one-click
 * offer instead. Staff-only accounts are left alone: they own no restaurant
 * to import into, so the manual panel is the honest place to explain that.
 */
export function decideLocalDraftClaim(inputs: LocalDraftClaimInputs): LocalDraftClaimAction {
  if (inputs.localCount <= 0) return "none";
  if (inputs.status !== "unseen") return "none";
  if (!inputs.accountSeenInBrowser) return "none";
  if (inputs.accountMenuCount === 0 && inputs.restaurantCount === 0) return "auto-import";
  if (inputs.ownedRestaurantCount === 0) return "none";
  return "offer";
}

const STORAGE_PREFIX = "eateryo:local-draft-claim:";
const BROWSER_ACCOUNT_KEY = "eateryo:browser-account";

/** Stable per-account key; exported for tests and storage diagnostics. */
export function localDraftClaimKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function browserStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLocalDraftClaim(userId: string): LocalDraftClaimStatus {
  const storage = browserStorage();
  if (!storage) return "unseen";
  try {
    const value = storage.getItem(localDraftClaimKey(userId));
    return value === "done" || value === "dismissed" ? value : "unseen";
  } catch {
    return "unseen";
  }
}

function writeClaimStatus(userId: string, status: Exclude<LocalDraftClaimStatus, "unseen">): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(localDraftClaimKey(userId), status);
  } catch {
    // The offer may reappear next time; that is recoverable, unlike losing
    // the drafts themselves.
  }
}

/** The account this browser was last used with (null = never signed in). */
export function loadBrowserAccount(): string | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    return storage.getItem(BROWSER_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

/** Remember the account after a successful sign-in. */
export function rememberBrowserAccount(userId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(BROWSER_ACCOUNT_KEY, userId);
  } catch {
    // Without it, a later account is offered the manual import instead of an
    // automatic one. Slower, never wrong.
  }
}

/** The import finished; do not ask again for this account. */
export function markLocalDraftsClaimed(userId: string): void {
  writeClaimStatus(userId, "done");
}

/** "Not now": keep the manual import available, but stop offering. */
export function dismissLocalDraftClaim(userId: string): void {
  writeClaimStatus(userId, "dismissed");
}
