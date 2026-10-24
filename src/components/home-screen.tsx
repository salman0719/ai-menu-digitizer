"use client";

import { useEffect, useRef, useState } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ConflictBanner } from "@/components/menu-editor/conflict-banner";
import { LibraryPanel } from "@/components/menu-editor/library-panel";
import {
  LocalDraftsNotice,
  LocalDraftsOffer,
  type LocalDraftClaimNotice,
} from "@/components/menu-editor/local-drafts-banner";
import { MoveToAccountPanel } from "@/components/menu-editor/move-to-account-panel";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { RestaurantSettings } from "@/components/settings/restaurant-settings";
import { RestaurantTables } from "@/components/tables/restaurant-tables";
import { OrdersBoard } from "@/components/orders/orders-board";
import { MonitorToasts } from "@/components/orders/monitor-toasts";
import { OrderMonitorProvider, useOrderMonitor } from "@/features/orders/monitor";
import { MenuEditor, SaveState } from "@/components/menu-editor/menu-editor";
import { PublishWizard } from "@/components/menu-editor/publish-wizard";
import { Dropzone } from "@/components/upload/dropzone";
import { ExtractionProgress } from "@/components/upload/extraction-progress";
import { ExtractionResult, PreviewMenu } from "@/components/upload/extraction-result";
import { ImagePreview, type PageImage } from "@/components/upload/image-preview";
import { extractedMenuToDocument } from "@/features/menu/convert";
import {
  downloadTextFile,
  menuFilename,
  menuToCsv,
  parseImportedMenu,
  serializeMenu,
} from "@/features/menu/import-export";
import { createMenuDocument, suggestRestaurantName } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import {
  cacheMenu,
  createMenu,
  deleteMenu,
  getImage,
  getMenu,
  listMenus,
  renameMenu,
  saveImage,
  saveMenu,
  StorageError,
  type MenuSummary,
} from "@/features/menu/storage";
import {
  deleteServerMenu,
  fetchServerMenu,
  fetchServerMenus,
  SyncError,
  updateServerMenu,
} from "@/features/menus/sync";
import {
  fetchPublication,
  publishMenu,
  setPublicationSlug,
  unpublishMenu,
} from "@/features/publishing/client";
import { usePathname } from "next/navigation";

import type { PublicationStatus } from "@/features/publishing/schema";
import type { PublishSetupResult } from "@/features/publishing/setup-schema";
import type { PreviewLayoutId, PreviewThemeId } from "@/features/menu/preview-themes";
import { authClient } from "@/lib/auth-client";
import {
  ExtractClientError,
  extractMenuFromFiles,
  type MenuExtractionResult,
} from "@/lib/extract-client";
import { SUPPORTED_IMAGE_MIME_TYPES, validateImageBatch } from "@/lib/image-constraints";
import { PrepareImageError, prepareImageForUpload } from "@/lib/prepare-image";
import {
  appRouteHref,
  moreSheetRows,
  parseAppRoute,
  phoneTabs,
  type AppRoute,
  type AppScreen,
  type EditorMode,
} from "@/features/navigation/routes";
import { useFeatureFlags } from "@/features/flags/client";
import { staffMenuIds } from "@/features/tenancy/access";
import {
  createRestaurant,
  fetchRestaurants,
  type RestaurantOption,
} from "@/features/tenancy/client";
import { moveLocalMenuToAccount, moveLocalMenusToAccount } from "@/features/menus/move-to-account";
import {
  decideLocalDraftClaim,
  dismissLocalDraftClaim,
  loadBrowserAccount,
  loadLocalDraftClaim,
  markLocalDraftsClaimed,
  rememberBrowserAccount,
  type LocalDraftClaimStatus,
} from "@/features/menus/claim-local-drafts";

type Phase = "upload" | "ready" | "extracting" | "done";

const STEPS = ["Upload image", "Extract menu", "Review draft"] as const;

/** Save status stays one word; `detail` says where the save went. */
function savedState(detail: string): SaveState {
  return { kind: "saved", message: "Saved", detail };
}

function routeMenuId(route: AppRoute): string | null {
  return route.screen === "editor" || route.screen === "item" ? route.menuId : null;
}

function stepIndex(phase: Phase, hasResult: boolean): number {
  if (hasResult || phase === "done") return 2;
  if (phase === "ready" || phase === "extracting") return 1;
  return 0;
}

/** Badge for unseen `new` orders; null when there is nothing to shout about. */
function NewOrdersBadge({ tone }: { tone: "bar" | "pill" }) {
  const { newCount } = useOrderMonitor();
  if (newCount === 0) return null;
  const label = newCount > 9 ? "9+" : String(newCount);
  if (tone === "pill") {
    return (
      <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
        {label}
      </span>
    );
  }
  return (
    <span className="absolute top-1 right-[calc(50%-22px)] flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
      {label}
    </span>
  );
}

/** Tells the monitor whether the board is open (opening it counts as seeing). */
function ViewingTracker({ viewing }: { viewing: boolean }) {
  const { setViewingBoard } = useOrderMonitor();
  useEffect(() => {
    setViewingBoard(viewing);
  }, [viewing, setViewingBoard]);
  return null;
}

/** New-order toasts above the tab bar; tapping opens the Orders tab. */
function MonitorToastStack({ onOpen }: { onOpen: () => void }) {
  const { toasts, dismissToast } = useOrderMonitor();
  return <MonitorToasts toasts={toasts} onOpen={onOpen} onDismiss={dismissToast} />;
}

/**
 * The whole signed-in/out app shell (capture → library → editor → …).
 * Every screen URL has its own route file that hands us its parsed route,
 * so a hard load server-renders the right screen instead of flashing the
 * capture screen first; after hydration `syncFromLocation` keeps `route`
 * in step with the History API.
 */
export function HomeScreen({ initialRoute }: { initialRoute: AppRoute }) {
  // The URL is the source of truth for the main screen and selected menu.
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const screen: AppScreen = route.screen === "item" ? "editor" : route.screen;
  const selectedItemId = route.screen === "item" ? route.itemId : null;
  /** R0 phone nav: the More sheet (Tables · Assistant · Settings · Get started). */
  const [moreOpen, setMoreOpen] = useState(false);
  /** Desktop pills: keep the active tab scrolled into view on narrow windows. */
  const pillsRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    pillsRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [screen]);
  // Which editor surface the URL asks for (edit, reorder, preview);
  // an item deep link is always the edit workspace.
  const editorMode: EditorMode = route.screen === "editor" ? route.mode : "edit";
  const routeRef = useRef<AppRoute>(route);
  const navigationReadyRef = useRef(false);
  const openedRouteMenuRef = useRef<string | null>(null);
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);
  const navigateToRef = useRef<
    ((next: AppRoute, replace?: boolean, flushCurrent?: boolean) => void) | null
  >(null);
  const openDocRef = useRef<
    ((doc: MenuDocument, image: Blob | null, updateRoute?: boolean) => Promise<void>) | null
  >(null);
  const activeDocIdRef = useRef<string | null>(null);

  function navigateTo(next: AppRoute, replace = false, flushCurrent = true) {
    const previousMenuId = routeMenuId(routeRef.current);
    if (flushCurrent && previousMenuId && previousMenuId !== routeMenuId(next)) {
      void flushSaveRef.current?.();
    }
    const href = appRouteHref(next);
    if (
      typeof window !== "undefined" &&
      window.location.pathname + window.location.search !== href
    ) {
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    }
    routeRef.current = next;
    setRoute(next);
    if (typeof window !== "undefined") navigationReadyRef.current = true;
  }

  // The visible screen must follow every URL change, however it happened:
  // tab clicks and in-app links write the History API directly (native
  // history is integrated with Next's router, so each path change surfaces
  // in `usePathname`), and back/forward fires `popstate`. Subscribing to the
  // pathname as well matters because a `<Link>` push whose target is the
  // page component already mounted swaps nothing — without this sync the
  // URL moves while the screen stays on the old one.
  const pathname = usePathname();
  useEffect(() => {
    const syncFromLocation = () => {
      const next = parseAppRoute(window.location.href);
      const previousMenuId = routeMenuId(routeRef.current);
      if (previousMenuId && previousMenuId !== routeMenuId(next)) {
        void flushSaveRef.current?.();
      }
      routeRef.current = next;
      setRoute(next);
      navigationReadyRef.current = true;
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [pathname]);

  // The assistant needs an account in every mode: a signed-out visitor who
  // lands on /assistant (typed URL, old bookmark) goes back to capture
  // instead of meeting an assistant-branded sign-in prompt. Runs every
  // render by design; the guard goes quiet once the screen moves on.
  useEffect(() => {
    if (!sessionPending && !signedIn && routeRef.current.screen === "assistant") {
      navigateTo({ screen: "capture" }, true);
    }
  });

  const [pages, setPages] = useState<PageImage[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [extracted, setExtracted] = useState<MenuExtractionResult | null>(null);
  /** Canonical form of the current result, for the phone-framed first look. */
  const [resultDoc, setResultDoc] = useState<MenuDocument | null>(null);
  /** Real progress for the extraction wait; null outside an extraction. */
  const [extractProgress, setExtractProgress] = useState<{
    pageCount: number;
    preparedPages: number;
    requestStartedAt: number | null;
  } | null>(null);
  /** Draft persisted automatically after a successful AI extraction. */
  const [draftSave, setDraftSave] = useState<"idle" | "saving" | "saved" | "unavailable">("idle");
  const draftDocRef = useRef<MenuDocument | null>(null);
  /** Guards autosave state against a newer extraction or a reset. */
  const draftTokenRef = useRef(0);
  const [demoDoc, setDemoDoc] = useState<MenuDocument | null>(null);
  const [source, setSource] = useState<"ai" | "demo">("ai");
  const [extractError, setExtractError] = useState<ExtractClientError | null>(null);

  // Library + editor state.
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  /** True until the first library read settles (skeleton rows, not the empty state). */
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [storageDown, setStorageDown] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<MenuDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(
    savedState("Saved in this browser. Sign in to use this menu on other devices.")
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  /** Preview URLs currently shown for `pages` (revoked on swap and unmount). */
  const liveUrlsRef = useRef<string[]>([]);
  /**
   * Mirror of `editorImageUrl`: the route effect must know whether the open
   * menu's source image is currently shown (ref read — no extra effect runs).
   */
  const editorImageUrlRef = useRef<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<MenuDocument | null>(null);
  const lastSavedRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageDownRef = useRef(false);

  // Server sync (Step 8): signed in = the account is authoritative, and the
  // IndexedDB copy stays as the offline cache. Signed out, nothing changes —
  // the whole local-first flow above keeps working untouched.
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const signedIn = session?.user != null;
  const accountKey = session?.user?.id ?? null;
  // Server-evaluated release decisions (A4). Both assistant flags default
  // off, so the tab and panel appear only for a released account or a
  // preview link; the loading state below avoids flashing “unavailable” while
  // the server answers.
  const { flags: featureFlags, loading: featureFlagsLoading } = useFeatureFlags(
    session?.user?.id ?? null
  );
  const signedInRef = useRef(false);
  /** The server updatedAt the open menu was last synced at; null = don't push. */
  const serverBaseRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState<{ serverUpdatedAt: string | null } | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const conflictRef = useRef<{ serverUpdatedAt: string | null } | null>(null);
  /** Ids of the caller's menus that exist on the server (chips + operations). */
  const serverIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [serverIds, setServerIds] = useState<ReadonlySet<string>>(new Set());
  /** Ids of account menus where the caller is staff only (view, never edit). */
  const staffMenusRef = useRef<ReadonlySet<string>>(new Set());
  const [staffMenus, setStaffMenus] = useState<ReadonlySet<string>>(new Set());
  /** Restaurants the caller owns: the targets for moving menus to the account. */
  const [ownedRestaurants, setOwnedRestaurants] = useState<RestaurantOption[]>([]);
  /** Which account the list belongs to; a mismatch means it is still loading. */
  const [ownedRestaurantsFor, setOwnedRestaurantsFor] = useState<string | null>(null);
  /** Every restaurant the caller belongs to, in any role (claim decisions). */
  const [restaurantCount, setRestaurantCount] = useState(0);
  /** Which account the restaurant count belongs to; null until it settles. */
  const [restaurantCountFor, setRestaurantCountFor] = useState<string | null>(null);
  /** Which account the server menu ids belong to; null until a merge settles. */
  const [serverMenusFor, setServerMenusFor] = useState<string | null>(null);
  /** The answer just given here; the stored per-account value is the fallback. */
  const [claimAnswer, setClaimAnswer] = useState<{
    accountKey: string;
    status: LocalDraftClaimStatus;
  } | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<LocalDraftClaimNotice | null>(null);
  /**
   * The first settled non-editor look at this account decides whether the
   * automatic import runs. Later local menus (a demo saved mid-session) are
   * never swept into an account behind the owner's back.
   */
  const claimEvaluatedRef = useRef<string | null>(null);
  /** Whether the last account in this browser is this one (or none yet). */
  const browserAccountAtSignInRef = useRef(false);
  /** Deduplicates concurrent account merges. */
  const mergeRef = useRef<Promise<void> | null>(null);

  // Publishing (Step 9): the open menu's public-link state, loaded on open
  // and refreshed whenever the preview is shown (that is when an owner looks
  // for "are my changes live?").
  const [publication, setPublication] = useState<PublicationStatus | null>(null);
  /** Which menu the loaded publication belongs to (guards against leaks). */
  const [publicationMenuId, setPublicationMenuId] = useState<string | null>(null);
  const [publicationLoaded, setPublicationLoaded] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    signedInRef.current = signedIn;
  }, [signedIn]);

  // Moving a single menu needs the owned restaurants up front, so each
  // browser-only row can offer its target without opening the move panel.
  useEffect(() => {
    if (!signedIn || !accountKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (cancelled) return;
        setOwnedRestaurants(list.filter((r) => r.role === "owner"));
        setOwnedRestaurantsFor(accountKey);
        setRestaurantCount(list.length);
        setRestaurantCountFor(accountKey);
      } catch {
        // Best-effort: the move panel shows its own load error, the wizard
        // explains a failed create, and the server still refuses a move the
        // caller may not make. Settle the loading state so the wizard can
        // still offer the form (the request will surface the real error).
        if (!cancelled) {
          setOwnedRestaurants([]);
          setOwnedRestaurantsFor(accountKey);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountKey, signedIn]);

  const result: PreviewMenu | null = extracted?.menu ?? demoDoc;

  useEffect(() => {
    return () => {
      liveUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      if (editorImageUrl) URL.revokeObjectURL(editorImageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  flushSaveRef.current = flushSave;
  navigateToRef.current = navigateTo;
  openDocRef.current = openDoc;
  activeDocIdRef.current = activeDoc?.id ?? null;
  editorImageUrlRef.current = editorImageUrl;

  useEffect(() => {
    if (!navigationReadyRef.current || !routeMenuId(route) || sessionPending) return;
    const menuId = routeMenuId(route);
    if (!menuId) return;
    if (activeDocIdRef.current === menuId) {
      openedRouteMenuRef.current = menuId;
      // Fast path: the doc is already in memory (editor mode switches, and
      // returns to a menu that was left open). "Back to library" releases
      // the source image URL while keeping the doc, so returning through
      // this path must restore the image — otherwise the editor reopens
      // without it. Only the image is re-read; the doc is not.
      if (editorImageUrlRef.current) return;
      let imageCancelled = false;
      void (async () => {
        try {
          const stored = await getImage(menuId);
          if (imageCancelled || activeDocIdRef.current !== menuId) return;
          setEditorImage(stored?.blob ? URL.createObjectURL(stored.blob) : null);
        } catch {
          // The editor is fully usable without the image; the next full
          // open of this menu retries the read.
        }
      })();
      return () => {
        imageCancelled = true;
      };
    }
    if (openedRouteMenuRef.current === menuId) return;
    openedRouteMenuRef.current = menuId;
    let cancelled = false;

    void (async () => {
      try {
        let doc: MenuDocument;
        let imageBlob: Blob | null = null;
        try {
          doc = await getMenu(menuId);
          try {
            imageBlob = (await getImage(menuId))?.blob ?? null;
          } catch {
            imageBlob = null;
          }
        } catch (localError) {
          if (!signedIn) throw localError;
          const serverMenu = await fetchServerMenu(menuId);
          doc = serverMenu.doc;
          await cacheMenu(doc).catch(() => undefined);
          await refreshLibrary();
        }
        if (!cancelled) await openDocRef.current?.(doc, imageBlob, false);
      } catch {
        if (cancelled) return;
        setLibraryError("That menu could not be opened. It may have been deleted or moved.");
        openedRouteMenuRef.current = null;
        navigateToRef.current?.({ screen: "library" }, true);
      }
    })();

    return () => {
      cancelled = true;
      if (openedRouteMenuRef.current === menuId) openedRouteMenuRef.current = null;
    };
  }, [route, sessionPending, signedIn]);

  useEffect(() => {
    if (!signedIn) {
      replaceServerIds(new Set());
      replaceStaffMenus(new Set());
      // State is compared with accountKey when read, so a stale value from
      // the previous session can never authorise an import for this one.
      claimEvaluatedRef.current = null;
      browserAccountAtSignInRef.current = false;
      return;
    }
    // A browser last used by another account must never auto-import its
    // cached menus into this one. Remember this account only after reading
    // the previous marker.
    const previousAccount = loadBrowserAccount();
    browserAccountAtSignInRef.current = previousAccount === null || previousAccount === accountKey;
    if (accountKey) rememberBrowserAccount(accountKey);
    // Sign-in: merge account menus into the library, and reconcile a menu
    // that was already open. A menu that was never moved to the account
    // stays local-only (serverBaseRef stays null), so this cannot loop.
    void refreshLibrary();
    void mergeAccountMenus();
    const doc = docRef.current;
    if (doc && serverBaseRef.current === null && !conflictRef.current) {
      void syncWithAccount(doc);
    }
    if (doc) void refreshPublication(doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  function replaceServerIds(next: ReadonlySet<string>) {
    serverIdsRef.current = next;
    setServerIds(next);
  }

  function replaceStaffMenus(next: ReadonlySet<string>) {
    staffMenusRef.current = next;
    setStaffMenus(next);
  }

  function addServerId(id: string) {
    if (serverIdsRef.current.has(id)) return;
    const next = new Set(serverIdsRef.current);
    next.add(id);
    replaceServerIds(next);
  }

  function removeServerId(id: string) {
    if (!serverIdsRef.current.has(id)) return;
    const next = new Set(serverIdsRef.current);
    next.delete(id);
    replaceServerIds(next);
  }

  async function refreshLibrary() {
    try {
      setMenus(await listMenus());
      setStorageDown(false);
      storageDownRef.current = false;
    } catch (error) {
      setStorageDown(true);
      storageDownRef.current = true;
      if (error instanceof StorageError) setLibraryError(error.message);
    } finally {
      setLibraryLoading(false);
    }
  }

  /**
   * Merge the account's menus into the local library (signed in only). A
   * menu that exists only on the server — moved from another device — is
   * downloaded and cached locally once, so the library lists and opens it
   * anywhere; afterwards it behaves like any local menu, reconciled with
   * the server revision on open. Best-effort: offline or a server DB that
   * is unavailable leaves the local library standing alone.
   */
  async function mergeAccountMenus() {
    if (!signedInRef.current || mergeRef.current) return;
    const run = (async () => {
      try {
        const serverMenus = await fetchServerMenus();
        replaceServerIds(new Set(serverMenus.map((menu) => menu.id)));
        // The claim offer waits for this: an empty set is only trustworthy
        // once the account has actually been read.
        if (signedInRef.current) setServerMenusFor(accountKey);
        try {
          replaceStaffMenus(staffMenuIds(serverMenus, await fetchRestaurants()));
        } catch {
          // Role lookup is best-effort; the server still refuses staff writes.
        }
        const localIds = new Set((await listMenus()).map((menu) => menu.id));
        let cachedAny = false;
        for (const summary of serverMenus) {
          if (localIds.has(summary.id)) continue;
          try {
            const full = await fetchServerMenu(summary.id);
            await cacheMenu(full.doc);
            cachedAny = true;
          } catch {
            // One failed download never blocks the rest; the menu stays in
            // the account and the next refresh retries it.
          }
        }
        if (cachedAny) setMenus(await listMenus());
      } catch {
        // Signed out mid-flight, offline, or the server DB is unavailable:
        // the local library stands alone.
      }
    })();
    mergeRef.current = run;
    try {
      await run;
    } finally {
      mergeRef.current = null;
    }
  }

  // --- Autosave -----------------------------------------------------------

  async function doSave() {
    const doc = docRef.current;
    if (!doc || storageDownRef.current) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedRef.current) {
      setSaveState(
        savedState(serverBaseRef.current ? "Saved to your account." : "Saved in this browser.")
      );
      return;
    }
    try {
      const saved = await saveMenu(doc);
      lastSavedRef.current = JSON.stringify(saved);
      setMenus(await listMenus());
      if (!(await pushToAccount(saved))) {
        setSaveState(
          conflictRef.current
            ? {
                ...savedState("Saved in this browser."),
                kind: "error",
                message: "Changed on your other device — choose which version wins above.",
              }
            : savedState("Saved in this browser.")
        );
      }
    } catch (error) {
      setSaveState({
        kind: "error",
        message:
          error instanceof StorageError ? error.message : "Save failed — edits are kept in memory.",
      });
    }
  }

  /**
   * Push a just-saved document to the account (Step 8). Returns false when
   * the save stays in this browser — signed out, menu not added to the
   * account yet, or a conflict awaiting an explicit decision — in which
   * case the caller sets the status. Otherwise the save state is set here
   * and true is returned.
   */
  async function pushToAccount(saved: MenuDocument): Promise<boolean> {
    if (!signedInRef.current || serverBaseRef.current === null) return false;
    // Staff access is view-only: keep the local copy, never push an edit.
    if (staffMenusRef.current.has(saved.id)) return false;
    if (conflictRef.current) return false;
    setSaveState({ kind: "saving", message: "Saving to your account…" });
    try {
      const pushed = await updateServerMenu(saved.id, saved, serverBaseRef.current);
      serverBaseRef.current = pushed.updatedAt;
      setSaveState(savedState("Saved to your account."));
      return true;
    } catch (error) {
      if (error instanceof SyncError && error.code === "conflict") {
        // Someone else wrote first. Keep the local edits, stop pushing, and
        // let the banner ask which version wins — never overwrite silently.
        conflictRef.current = { serverUpdatedAt: error.currentUpdatedAt };
        setConflict(conflictRef.current);
        setConflictError(null);
        setSaveState({
          kind: "error",
          message: "Changed on your other device — choose which version wins above.",
        });
        return true;
      }
      if (error instanceof SyncError && error.code === "unauthorized") {
        serverBaseRef.current = null;
        setSaveState(
          savedState("Saved in this browser — sign in again to save it to your account.")
        );
        return true;
      }
      if (error instanceof SyncError && error.code === "forbidden") {
        serverBaseRef.current = null;
        setSaveState(
          savedState("Saved in this browser — you don't have write access to this menu.")
        );
        return true;
      }
      if (error instanceof SyncError && error.code === "not_found") {
        serverBaseRef.current = null;
        removeServerId(saved.id);
        setSaveState(savedState("Saved in this browser — this menu is no longer in your account."));
        return true;
      }
      // Offline / server down: the browser copy is safe and retried next save.
      setSaveState(savedState("Saved in this browser — your account can't be reached right now."));
      return true;
    }
  }

  async function flushSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await doSave();
  }

  /** Every editor change flows through here: update state + debounced save. */
  function handleDocChange(next: MenuDocument) {
    setActiveDoc(next);
    docRef.current = next;
    if (storageDownRef.current) {
      setSaveState({
        kind: "error",
        message: "Storage unavailable — edits are kept in memory only.",
      });
      return;
    }
    setSaveState({ kind: "saving", message: "Saving…" });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void doSave(), 600);
  }

  function setEditorImage(url: string | null) {
    setEditorImageUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
  }

  async function openDoc(doc: MenuDocument, imageBlob: Blob | null, updateRoute = true) {
    setPublication(null);
    setPublicationMenuId(null);
    setPublicationLoaded(false);
    setPublishError(null);
    void refreshPublication(doc.id);
    docRef.current = doc;
    lastSavedRef.current = JSON.stringify(doc);
    setActiveDoc(doc);
    setSaveState(
      storageDownRef.current
        ? { kind: "error", message: "Storage unavailable — edits are kept in memory only." }
        : savedState("Saved in this browser.")
    );
    setImportError(null);
    setEditorImage(imageBlob ? URL.createObjectURL(imageBlob) : null);
    if (updateRoute) navigateTo({ screen: "editor", menuId: doc.id, mode: "edit" });
    void syncWithAccount(doc);
  }

  /**
   * Reconcile a just-opened menu with the account (signed in only). The
   * account is authoritative: when it holds a different revision, adopt it
   * and keep IndexedDB in step as the cache. Menus that were never added to
   * the account stay in this browser — "Add to account" is the explicit path
   * for those.
   */
  async function syncWithAccount(localDoc: MenuDocument) {
    serverBaseRef.current = null;
    conflictRef.current = null;
    setConflict(null);
    setConflictError(null);
    if (!signedInRef.current) return;
    try {
      const serverMenu = await fetchServerMenu(localDoc.id);
      if (docRef.current?.id !== localDoc.id) return;
      serverBaseRef.current = serverMenu.updatedAt;
      addServerId(localDoc.id);
      const stripStamp = (value: MenuDocument) => JSON.stringify({ ...value, updatedAt: "" });
      if (stripStamp(serverMenu.doc) !== stripStamp(localDoc)) {
        let next: MenuDocument = serverMenu.doc;
        if (!storageDownRef.current) {
          next = await saveMenu(serverMenu.doc).catch(() => serverMenu.doc);
        }
        if (docRef.current?.id !== localDoc.id) return;
        docRef.current = next;
        lastSavedRef.current = JSON.stringify(next);
        setActiveDoc(next);
        setSaveState(savedState("Showing the version from your account."));
        await refreshLibrary();
        return;
      }
      setSaveState(savedState("Saved to your account."));
    } catch (error) {
      if (docRef.current?.id !== localDoc.id) return;
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(localDoc.id);
        setSaveState(savedState("Saved in this browser — not in your account yet."));
        return;
      }
      if (error instanceof SyncError && error.code === "unauthorized") {
        setSaveState(
          savedState("Saved in this browser — sign in again to save it to your account.")
        );
        return;
      }
      setSaveState(savedState("Saved in this browser — your account can't be reached right now."));
    }
  }

  /** Conflict action: adopt the account's revision, discarding local edits. */
  async function handleLoadServerVersion() {
    const doc = docRef.current;
    if (!doc) return;
    setConflictError(null);
    try {
      const serverMenu = await fetchServerMenu(doc.id);
      let next: MenuDocument = serverMenu.doc;
      if (!storageDownRef.current) {
        next = await saveMenu(serverMenu.doc).catch(() => serverMenu.doc);
      }
      if (docRef.current?.id !== doc.id) return;
      docRef.current = next;
      lastSavedRef.current = JSON.stringify(next);
      setActiveDoc(next);
      serverBaseRef.current = serverMenu.updatedAt;
      conflictRef.current = null;
      setConflict(null);
      setSaveState(savedState("Showing the version from your account."));
      await refreshLibrary();
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        conflictRef.current = { serverUpdatedAt: null };
        setConflict({ serverUpdatedAt: null });
        setConflictError("This menu is no longer in your account — keeping your version is safe.");
        return;
      }
      setConflictError(
        "Could not load the version from your account. Check your connection and try again."
      );
    }
  }

  /** Conflict action: push the local revision over the account's, explicitly. */
  async function handleKeepMyVersion() {
    const doc = docRef.current;
    const expected = conflict?.serverUpdatedAt ?? null;
    if (!doc || expected === null) return;
    setConflictError(null);
    try {
      const pushed = await updateServerMenu(doc.id, doc, expected);
      serverBaseRef.current = pushed.updatedAt;
      conflictRef.current = null;
      setConflict(null);
      setSaveState(savedState("Saved to your account."));
    } catch (error) {
      if (error instanceof SyncError && error.code === "conflict") {
        conflictRef.current = { serverUpdatedAt: error.currentUpdatedAt };
        setConflict(conflictRef.current);
        setConflictError("It changed again while you were deciding — review and choose once more.");
        return;
      }
      if (error instanceof SyncError && error.code === "not_found") {
        conflictRef.current = { serverUpdatedAt: null };
        setConflict({ serverUpdatedAt: null });
        setConflictError(
          "This menu is no longer in your account — your version stays saved in this browser."
        );
        return;
      }
      setConflictError("Could not save to your account. Your edits are safe in this browser.");
    }
  }

  // --- Library actions ----------------------------------------------------

  function handleOpenMenu(id: string) {
    setLibraryError(null);
    navigateTo({ screen: "editor", menuId: id, mode: "edit" });
  }

  async function handleNewMenu() {
    setLibraryError(null);
    const doc = storageDownRef.current
      ? createMenuDocument({ title: "Untitled menu" })
      : await createMenu("Untitled menu").catch((error: unknown) => {
          setLibraryError(
            error instanceof StorageError ? error.message : "Could not create a menu."
          );
          return null;
        });
    if (!doc) return;
    if (!storageDownRef.current) await refreshLibrary();
    await openDoc(doc, null);
  }

  async function handleRenameMenu(id: string, title: string) {
    try {
      const renamed = await renameMenu(id, title);
      if (signedInRef.current && serverIdsRef.current.has(id)) {
        await pushRenameToAccount(renamed);
      }
      await refreshLibrary();
      if (docRef.current?.id === id) {
        docRef.current = renamed;
        lastSavedRef.current = JSON.stringify(renamed);
        setActiveDoc(renamed);
      }
    } catch (error) {
      setLibraryError(
        error instanceof StorageError ? error.message : "Could not rename that menu."
      );
    }
  }

  /**
   * Push a library rename to the account. The base revision is fetched
   * first — a library rename can target a menu the editor doesn't have
   * open, so there is no `serverBaseRef` to lean on. A conflict is
   * reported, never overwritten; it resolves on the next editor open,
   * which adopts the account revision. The local rename always stands.
   */
  async function pushRenameToAccount(renamed: MenuDocument) {
    try {
      const serverMenu = await fetchServerMenu(renamed.id);
      try {
        const pushed = await updateServerMenu(renamed.id, renamed, serverMenu.updatedAt);
        if (docRef.current?.id === renamed.id) serverBaseRef.current = pushed.updatedAt;
      } catch (error) {
        if (error instanceof SyncError && error.code === "not_found") {
          removeServerId(renamed.id); // Gone on the server; nothing to push.
        } else if (error instanceof SyncError && error.code === "conflict") {
          setLibraryError(
            "Renamed in this browser — it changed on your other device. Open the menu to reconcile."
          );
        } else if (error instanceof SyncError && error.code === "forbidden") {
          setLibraryError(
            "Renamed in this browser — only the restaurant owner can rename it on your account."
          );
        } else if (error instanceof SyncError && error.code === "unauthorized") {
          setLibraryError("Renamed in this browser — sign in again to rename it on your account.");
        } else {
          setLibraryError(
            "Renamed in this browser — the change could not be saved to your account. Try again when online."
          );
        }
      }
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(renamed.id);
        return;
      }
      setLibraryError(
        "Renamed in this browser — your account could not be reached. Try again when online."
      );
    }
  }

  /**
   * Add one browser-only menu to an owned restaurant. The library row shows
   * the returned message on failure; success marks the row as on the account
   * right away, then reconciles with the server list.
   */
  async function handleMoveMenuToAccount(
    menuId: string,
    restaurantId: string
  ): Promise<string | null> {
    const title = menus.find((menu) => menu.id === menuId)?.title ?? "That menu";
    const outcome = await moveLocalMenuToAccount(restaurantId, menuId);
    if (outcome.status === "failed") {
      return `“${title}” could not be added — ${outcome.reason}`;
    }
    addServerId(menuId);
    await mergeAccountMenus();
    return null;
  }

  /**
   * Copy the rest of this browser's menus into one owned restaurant. Shared
   * by the one-click offer, the automatic import for a brand-new account,
   * and the import that follows the wizard creating the account's first
   * café. The local copies stay put; the notice reports per-batch totals.
   */
  async function runLocalDraftClaim(restaurantId: string, restaurantName: string) {
    setClaimBusy(true);
    setClaimError(null);
    try {
      const report = await moveLocalMenusToAccount(restaurantId);
      [...report.imported, ...report.skipped].forEach((id) => addServerId(id));
      setClaimNotice({
        imported: report.imported.length,
        failed: report.failed.length,
        restaurantName,
      });
      if (accountKey) {
        markLocalDraftsClaimed(accountKey);
        setClaimAnswer({ accountKey, status: "done" });
      }
      await refreshLibrary();
      void mergeAccountMenus();
    } catch {
      setClaimError(
        "We couldn't read the menus saved in this browser. They are still here — try again from My menus."
      );
    } finally {
      setClaimBusy(false);
    }
  }

  /**
   * A brand-new account (no menus, no restaurants) adopts this browser's
   * drafts in one go. The café name comes from the menu titles, never a
   * placeholder the owner cannot recognise.
   */
  async function handleAutoClaim(titles: string[]) {
    if (!accountKey) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      const name = suggestRestaurantName(titles) ?? "My restaurant";
      const created = await createRestaurant(name);
      setOwnedRestaurants((current) =>
        current.some((restaurant) => restaurant.id === created.id) ? current : [...current, created]
      );
      setOwnedRestaurantsFor(accountKey);
      setRestaurantCount((count) => count + 1);
      setRestaurantCountFor(accountKey);
      await runLocalDraftClaim(created.id, created.name);
    } catch {
      setClaimError(
        "We couldn't set up your café automatically. Import your menus from My menus when you're ready."
      );
    } finally {
      setClaimBusy(false);
    }
  }

  function handleClaimAdd(restaurantId: string) {
    const restaurant = ownedRestaurantsForAccount.find((item) => item.id === restaurantId);
    if (!restaurant) return;
    void runLocalDraftClaim(restaurant.id, restaurant.name);
  }

  function handleDismissClaim() {
    if (!accountKey) return;
    dismissLocalDraftClaim(accountKey);
    setClaimAnswer({ accountKey, status: "dismissed" });
  }

  /** Load the open menu's publication state (signed in only). */
  async function refreshPublication(menuId: string) {
    if (!signedInRef.current) {
      setPublication(null);
      setPublicationMenuId(null);
      setPublicationLoaded(false);
      return;
    }
    setPublicationMenuId(menuId);
    try {
      const status = await fetchPublication(menuId);
      if (docRef.current?.id !== menuId) return;
      setPublication(status);
      setPublishError(null);
    } catch (error) {
      if (docRef.current?.id !== menuId) return;
      if (error instanceof SyncError && error.code === "not_found") {
        setPublication(null);
      } else {
        setPublishError("Could not check the public link. Try again in a moment.");
      }
    } finally {
      if (docRef.current?.id === menuId) setPublicationLoaded(true);
    }
  }

  function publishErrorMessage(error: unknown): string {
    if (error instanceof SyncError) {
      switch (error.code) {
        case "unauthorized":
          return "Sign in again to publish this menu.";
        case "forbidden":
          return "Only the restaurant owner can publish this menu.";
        case "not_found":
          return "This menu is no longer in your account. Open it again to reconcile.";
        case "slug_taken":
          return "That link is already used by another menu at this café — pick another link name.";
        case "not_published":
          return "This menu is not published.";
        case "invalid":
          return error.message;
        default:
          return "Could not reach the server. Try again when you are online.";
      }
    }
    return "Something went wrong. Your edits are safe in this browser.";
  }

  /**
   * Publish (or publish changes): flush the pending save first so the
   * snapshot is of what the owner just saw, never of a stale draft.
   */
  async function handlePublish(theme: PreviewThemeId, layout: PreviewLayoutId) {
    const doc = docRef.current;
    if (!doc) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      await flushSave();
      if (!serverIdsRef.current.has(doc.id)) {
        setPublishError("Add this menu to your account first, then publish it.");
        return;
      }
      const status = await publishMenu(doc.id, { theme, layout });
      setPublication(status);
      setPublicationLoaded(true);
    } catch (error) {
      setPublishError(publishErrorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleUnpublish() {
    const doc = docRef.current;
    if (!doc) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      setPublication(await unpublishMenu(doc.id));
    } catch (error) {
      setPublishError(publishErrorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleChangeSlug(slug: string) {
    const doc = docRef.current;
    if (!doc) return;
    setPublishError(null);
    setPublishBusy(true);
    try {
      setPublication(await setPublicationSlug(doc.id, slug));
    } catch (error) {
      setPublishError(publishErrorMessage(error));
    } finally {
      setPublishBusy(false);
    }
  }

  /**
   * The wizard published (or attached) this menu. Make the shell agree with
   * the server immediately: the library chip, the publication panel and the
   * next save's conflict baseline.
   */
  function handleWizardPublished(result: PublishSetupResult) {
    const menuId = result.publication.menuId;
    addServerId(menuId);
    setPublication(result.publication);
    setPublicationMenuId(menuId);
    setPublicationLoaded(true);
    setPublishError(null);
    void (async () => {
      try {
        const server = await fetchServerMenu(menuId);
        if (docRef.current?.id === menuId) serverBaseRef.current = server.updatedAt;
      } catch {
        // The next editor open reconciles the baseline; publishing already
        // succeeded, so this must not surface as a failure.
      }
    })();
    void mergeAccountMenus();
    void refreshLibrary();
    // The wizard just created the account's first café, so the other drafts
    // in this browser have a home. This runs after the publish succeeds, so
    // it cannot race the wizard for “create the restaurant”.
    if (result.created.restaurant && accountKey) {
      const otherDrafts = localOnly.filter((menu) => menu.id !== menuId);
      if (otherDrafts.length > 0) {
        void runLocalDraftClaim(result.restaurant.id, result.restaurant.name);
      }
    }
  }

  async function handleDeleteMenu(id: string) {
    try {
      // Remove it from the account first when it is there, so a failure is
      // reported before the browser copy is gone. The browser delete always
      // proceeds — it is the user's data and their explicit intent.
      let accountNote: string | null = null;
      if (signedInRef.current && serverIdsRef.current.has(id)) {
        try {
          await deleteServerMenu(id);
          removeServerId(id);
        } catch (error) {
          if (error instanceof SyncError && error.code === "not_found") {
            removeServerId(id); // Already gone on the server.
          } else if (error instanceof SyncError && error.code === "forbidden") {
            accountNote =
              "Deleted from this browser — only the restaurant owner can remove it from your account.";
          } else if (error instanceof SyncError && error.code === "unauthorized") {
            accountNote =
              "Deleted from this browser — sign in again to remove it from your account.";
          } else {
            accountNote =
              "Deleted from this browser — it could not be removed from your account. Try again when online.";
          }
        }
      }
      await deleteMenu(id);
      removeServerId(id);
      if (docRef.current?.id === id) {
        docRef.current = null;
        lastSavedRef.current = null;
        serverBaseRef.current = null;
        conflictRef.current = null;
        setConflict(null);
        setActiveDoc(null);
        setEditorImage(null);
      }
      setPublication(null);
      setPublicationMenuId(null);
      setPublicationLoaded(false);
      setPublishError(null);
      await refreshLibrary();
      if (accountNote) setLibraryError(accountNote);
      navigateTo({ screen: "library" }, false, false);
    } catch (error) {
      setLibraryError(
        error instanceof StorageError ? error.message : "Could not delete that menu."
      );
    }
  }

  async function handleBackToLibrary() {
    await flushSave();
    setEditorImage(null);
    await refreshLibrary();
    void mergeAccountMenus();
    navigateTo({ screen: "library" }, false, false);
  }

  // --- Capture flow -------------------------------------------------------

  function scrollToResult() {
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  function confirmDiscard(
    message = "This will discard the current extracted menu. Continue?"
  ): boolean {
    if (!extracted && !demoDoc) return true;
    return window.confirm(message);
  }

  /**
   * Swap the whole selection for `nextFiles`: release old preview URLs,
   * show the new ones, and drop any stale extraction result. Callers have
   * already confirmed discarding and validated the batch.
   */
  function applySelection(nextFiles: File[]) {
    // Any change of pages invalidates the draft tied to the old selection.
    draftTokenRef.current += 1;
    draftDocRef.current = null;
    setDraftSave("idle");
    pages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    const next = nextFiles.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    liveUrlsRef.current = next.map((page) => page.previewUrl);
    setPages(next);
    setFileError(null);
    setExtractError(null);
    setExtracted(null);
    setResultDoc(null);
    setDemoDoc(null);
    setExtractProgress(null);
    setPhase(next.length > 0 ? "ready" : "upload");
  }

  /** Start (or restart) a selection from the dropzone — replaces every page. */
  function selectFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    if (!confirmDiscard()) return;
    const check = validateImageBatch(incoming);
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    applySelection(incoming);
  }

  /**
   * Append pages to the current selection; the whole set is validated as one
   * batch. Adding a page never discards the images — only a previous
   * extraction of them is stale — so the confirm says exactly that, and the
   * new extraction runs right away over the old pages plus the new ones
   * instead of making the user press Extract a second time.
   */
  function addPages(incoming: File[]) {
    if (incoming.length === 0) return;
    if (phase === "extracting") {
      setFileError("An extraction is running — add pages once it finishes.");
      return;
    }
    const combined = [...pages.map((page) => page.file), ...incoming];
    const check = validateImageBatch(combined);
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    // The add control only exists while pages are selected, so there is
    // always a previous selection to combine; the guard in confirmDiscard
    // decides whether there is an extraction result worth confirming.
    const confirmMessage =
      `This discards the current extraction result — the images themselves are kept. ` +
      `A new extraction will run on all ${combined.length} images together: the ` +
      `${pages.length} already selected plus ${incoming.length} new ` +
      `${incoming.length === 1 ? "page" : "pages"}. Continue?`;
    if (!confirmDiscard(confirmMessage)) return;
    applySelection(combined);
    void extractFiles(combined);
  }

  /** Replace one page, keeping the rest of the selection in place. */
  function replacePageAt(index: number, nextFile: File) {
    if (!pages[index]) return;
    const check = validateImageBatch(pages.map((page, i) => (i === index ? nextFile : page.file)));
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    applySelection(pages.map((page, i) => (i === index ? nextFile : page.file)));
  }

  /** Drop one page; dropping the last one returns to the dropzone. */
  function removePage(index: number) {
    if (!confirmDiscard()) return;
    applySelection(pages.filter((_, i) => i !== index).map((page) => page.file));
  }

  function clearCapture() {
    applySelection([]);
  }

  /** Run one extraction over an explicit file list (normally the selection). */
  async function extractFiles(files: File[]) {
    if (files.length === 0 || phase === "extracting") return;
    setPhase("extracting");
    setFileError(null);
    setExtractError(null);
    setExtractProgress({ pageCount: files.length, preparedPages: 0, requestStartedAt: null });
    try {
      // Normalize first: AVIF is transcoded to JPEG here because the provider
      // cannot read it, and mislabeled files get their real MIME type. One at
      // a time, so the page count in the progress panel is a real milestone.
      const prepared: Awaited<ReturnType<typeof prepareImageForUpload>>[] = [];
      for (const file of files) {
        prepared.push(await prepareImageForUpload(file));
        setExtractProgress((current) =>
          current ? { ...current, preparedPages: current.preparedPages + 1 } : current
        );
      }
      setExtractProgress((current) =>
        current ? { ...current, requestStartedAt: Date.now() } : current
      );
      const extraction = await extractMenuFromFiles(
        prepared.map((image) => new File([image.blob], image.filename, { type: image.mimeType }))
      );
      const previewDoc =
        extraction.menu.categories.length > 0
          ? extractedMenuToDocument(extraction.menu, {
              provider: extraction.provider,
              model: extraction.model,
              originalFileName: files[0]?.name,
            })
          : null;
      setResultDoc(previewDoc);
      setExtracted(extraction);
      setSource("ai");
      setPhase("done");
      void autoSaveDraft(extraction, files[0] ?? null, previewDoc);
    } catch (error) {
      setExtractError(
        error instanceof ExtractClientError
          ? error
          : error instanceof PrepareImageError
            ? new ExtractClientError("invalid_file_type", error.message)
            : new ExtractClientError("internal_error", "Something went wrong. Try again.")
      );
      setPhase("ready");
    }
    scrollToResult();
  }

  function handleExtract() {
    void extractFiles(pages.map((page) => page.file));
  }

  function handleDemo() {
    if (!confirmDiscard()) return;
    clearCapture();
    const doc = createSampleMenuDocument();
    setDemoDoc(doc);
    setResultDoc(doc);
    setSource("demo");
    setPhase("done");
    scrollToResult();
  }

  /**
   * Persist an extraction immediately, so reviewing the draft in the editor
   * is optional rather than the act of saving. Skips empty results (nothing
   * worth storing) and keeps the newest draft when extractions overlap.
   */
  async function autoSaveDraft(
    extraction: MenuExtractionResult,
    primaryPage: File | null,
    existingDoc: MenuDocument | null = null
  ) {
    const token = (draftTokenRef.current += 1);
    if (extraction.menu.categories.length === 0) {
      draftDocRef.current = null;
      setDraftSave("idle");
      return;
    }
    const doc =
      existingDoc ??
      extractedMenuToDocument(extraction.menu, {
        provider: extraction.provider,
        model: extraction.model,
        originalFileName: primaryPage?.name,
      });
    draftDocRef.current = doc;
    // One blob per menu: the first page stands in as the source image.
    const primaryPageBlob = primaryPage;
    if (storageDownRef.current) {
      setDraftSave("unavailable");
      return;
    }
    setDraftSave("saving");
    try {
      const saved = await saveMenu(doc);
      if (primaryPageBlob) {
        try {
          await saveImage(saved.id, primaryPageBlob);
        } catch {
          // Image is optional; the menu matters.
        }
      }
      if (token !== draftTokenRef.current) return;
      draftDocRef.current = saved;
      setDraftSave("saved");
      await refreshLibrary();
    } catch (error) {
      if (token !== draftTokenRef.current) return;
      setDraftSave("unavailable");
      setExtractError(
        new ExtractClientError(
          "internal_error",
          error instanceof StorageError
            ? error.message
            : "The draft could not be saved in this browser, but you can still edit it."
        )
      );
    }
  }

  /** Save the current result (AI or demo) and open it in the editor. */
  /**
   * Persist the current result and open it. The wizard entry point reuses
   * this without touching the URL, then navigates once to its own mode.
   */
  async function saveResultAndOpen(updateRoute = true): Promise<MenuDocument> {
    if (source === "ai" && extracted) {
      const firstPage = pages[0];
      // Reuse the autosaved draft instead of writing a second record.
      const doc =
        draftDocRef.current ??
        extractedMenuToDocument(extracted.menu, {
          provider: extracted.provider,
          model: extracted.model,
          originalFileName: firstPage?.file.name,
        });
      const saved = storageDownRef.current ? doc : await saveMenu(doc);
      if (firstPage && !storageDownRef.current) {
        try {
          // One blob per menu: the first page stands in as the source image.
          await saveImage(saved.id, firstPage.file);
        } catch {
          // Image is optional; the menu matters.
        }
      }
      if (!storageDownRef.current) await refreshLibrary();
      await openDoc(saved, firstPage ? firstPage.file : null, updateRoute);
      return saved;
    }
    const doc = demoDoc ?? createSampleMenuDocument();
    const saved = storageDownRef.current ? doc : await saveMenu(doc);
    if (!storageDownRef.current) await refreshLibrary();
    await openDoc(saved, null, updateRoute);
    return saved;
  }

  function showOpenError(error: unknown) {
    setExtractError(
      new ExtractClientError(
        "internal_error",
        error instanceof StorageError ? error.message : "Could not open the editor. Try again."
      )
    );
    scrollToResult();
  }

  async function handleEditResult() {
    try {
      await saveResultAndOpen();
    } catch (error) {
      showOpenError(error);
    }
  }

  /** From the extraction result: save the draft, then open the publish wizard. */
  async function handleStartPublish() {
    try {
      const saved = await saveResultAndOpen(false);
      navigateTo({ screen: "editor", menuId: saved.id, mode: "publish" });
    } catch (error) {
      showOpenError(error);
    }
  }

  // --- Import / export ----------------------------------------------------

  function handleExportJson() {
    const doc = docRef.current;
    if (!doc) return;
    try {
      downloadTextFile(menuFilename(doc.title, "json"), serializeMenu(doc), "application/json");
    } catch {
      setImportError("Export failed: the menu data is invalid.");
    }
  }

  function handleExportCsv() {
    const doc = docRef.current;
    if (!doc) return;
    try {
      downloadTextFile(menuFilename(doc.title, "csv"), menuToCsv(doc), "text/csv");
    } catch {
      setImportError("Export failed: the menu data is invalid.");
    }
  }

  async function handleImportFile(importFile: File) {
    setImportError(null);
    try {
      const doc = parseImportedMenu(await importFile.text());
      const saved = storageDownRef.current ? doc : await saveMenu(doc);
      if (!storageDownRef.current) await refreshLibrary();
      await openDoc(saved, null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import that file.");
    }
  }

  const activeStep = stepIndex(phase, result !== null);
  const assistantPending = sessionPending || (signedIn && featureFlagsLoading);

  // Library rows carry their account state: menus on the server show as
  // synced; the rest are browser-only until moved (or downloaded).
  const libraryMenus = menus.map((menu) => ({ ...menu, onServer: serverIds.has(menu.id) }));
  const localOnly = libraryMenus.filter((menu) => !menu.onServer);
  const localOnlyCount = localOnly.length;
  // A list cached from another account is never offered as a move target.
  const ownedRestaurantsForAccount = ownedRestaurantsFor === accountKey ? ownedRestaurants : [];
  const restaurantsLoading = signedIn && ownedRestaurantsFor !== accountKey;
  // A name for the first-run "Name your restaurant" field, guessed from the
  // titles of the menus the move would copy (null when they say nothing).
  const suggestedRestaurantName = suggestRestaurantName(localOnly.map((menu) => menu.title));

  // The claim surfaces stay out of the editor: importing the menu that is
  // open would create an account version the editor is not synced with. The
  // wizard's own publish handles the open draft, and the post-publish import
  // above covers the rest.
  const storedClaimStatus = accountKey ? loadLocalDraftClaim(accountKey) : "unseen";
  const claimStatus =
    claimAnswer?.accountKey === accountKey ? claimAnswer.status : storedClaimStatus;
  const localDraftsDecision =
    signedIn &&
    !sessionPending &&
    screen !== "editor" &&
    serverMenusFor === accountKey &&
    restaurantCountFor === accountKey
      ? decideLocalDraftClaim({
          localCount: localOnlyCount,
          accountMenuCount: serverIds.size,
          restaurantCount,
          ownedRestaurantCount: ownedRestaurantsForAccount.length,
          status: claimStatus,
          accountSeenInBrowser: browserAccountAtSignInRef.current,
        })
      : "none";

  useEffect(() => {
    if (!signedIn || !accountKey || screen === "editor") return;
    if (serverMenusFor !== accountKey || restaurantCountFor !== accountKey) return;
    if (claimEvaluatedRef.current === accountKey) return;
    claimEvaluatedRef.current = accountKey;
    if (localDraftsDecision !== "auto-import") return;
    const titles = localOnly.map((menu) => menu.title);
    // Deferred: the effect must not set state synchronously while rendering
    // the frame that made the decision.
    void Promise.resolve().then(() => handleAutoClaim(titles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountKey,
    claimStatus,
    localDraftsDecision,
    restaurantCountFor,
    screen,
    serverMenusFor,
    signedIn,
  ]);

  // Publish state is only ever shown for the menu it was loaded for; a stale
  // answer for a previously opened menu is never displayed.
  const activePublicationMenuId = activeDoc?.id ?? null;
  const activePublication = publicationMenuId === activePublicationMenuId ? publication : null;
  const activePublicationLoaded =
    publicationMenuId === activePublicationMenuId && publicationLoaded;
  // Staff on the menu's restaurant get a view-only editor (the server refuses
  // their writes anyway; the UI must not offer the controls at all).
  const activeMenuIsStaff = activeDoc ? staffMenus.has(activeDoc.id) : false;

  return (
    <OrderMonitorProvider userId={session?.user?.id ?? null}>
    <div className="flex min-h-full flex-1 flex-col">
      <ViewingTracker viewing={signedIn && screen === "orders"} />
      <SiteHeader />
      <main
        className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-8 ${
          // The editor is a dense working surface: give it a wider canvas on
          // large screens. Capture and library stay at a readable measure.
          screen === "editor" ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        {/* Desktop pill row. Phones use the bottom tab bar below. */}
        {screen !== "editor" && (
          <nav
            data-print-hide
            aria-label="Sections"
            ref={pillsRef}
            className="hidden gap-2 overflow-x-auto pb-1 sm:flex"
          >
            {(
              [
                { id: "capture", label: "Capture" },
                { id: "library", label: `My menus${menus.length ? ` (${menus.length})` : ""}` },
                { id: "orders", label: "Orders" },
                // R0: tabs are always rendered so the app never changes shape
                // signed out. Tables/Settings render their own signed-out
                // explanation; the assistant is never offered signed out
                // (its kill switch, A4, only gates signed-in accounts).
                ...(signedIn && featureFlags.assistant
                  ? [{ id: "assistant" as const, label: "Assistant" }]
                  : []),
                { id: "tables" as const, label: "Tables" },
                { id: "settings" as const, label: "Settings" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigateTo({ screen: tab.id })}
                aria-current={screen === tab.id ? "page" : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 ${
                  screen === tab.id
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-600 ring-1 ring-stone-200 hover:text-stone-900"
                }`}
              >
                {tab.label}
                {tab.id === "orders" && <NewOrdersBadge tone="pill" />}
              </button>
            ))}
          </nav>
        )}

        {signedIn && claimNotice && (
          <LocalDraftsNotice
            notice={claimNotice}
            onOpenLibrary={() => navigateTo({ screen: "library" })}
            onDismiss={() => setClaimNotice(null)}
          />
        )}
        {!claimNotice &&
          localDraftsDecision === "offer" &&
          ownedRestaurantsForAccount.length > 0 && (
            <LocalDraftsOffer
              count={localOnlyCount}
              restaurants={ownedRestaurantsForAccount}
              busy={claimBusy}
              onAdd={handleClaimAdd}
              onDismiss={handleDismissClaim}
            />
          )}
        {signedIn && claimError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>{claimError}</p>
              <button
                type="button"
                onClick={() => setClaimError(null)}
                className="text-xs font-medium underline underline-offset-2 hover:text-red-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {screen === "library" && (
          <div className="flex flex-col gap-4">
            {libraryError && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {libraryError}
              </p>
            )}
            <LibraryPanel
              menus={libraryMenus}
              loading={libraryLoading}
              accountMode={signedIn}
              ownedRestaurants={signedIn ? ownedRestaurantsForAccount : []}
              onMoveToAccount={handleMoveMenuToAccount}
              unavailable={storageDown}
              onOpen={(id) => void handleOpenMenu(id)}
              onNew={() => void handleNewMenu()}
              onRename={(id, title) => void handleRenameMenu(id, title)}
              onDelete={(id) => void handleDeleteMenu(id)}
            />
            {/* The manual route stays available, quietly: the post-sign-in
                offer handles the common case, and this is where a partial
                import is retried. */}
            {signedIn && localOnlyCount > 0 && (
              <details className="rounded-2xl border border-stone-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-stone-700 marker:text-stone-400">
                  Import from this browser
                  <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                    {localOnlyCount}
                  </span>
                </summary>
                <div className="border-t border-stone-200">
                  <MoveToAccountPanel
                    menuCount={localOnlyCount}
                    suggestedName={suggestedRestaurantName}
                    onMoved={() => void mergeAccountMenus()}
                    onOwnedChange={setOwnedRestaurants}
                  />
                </div>
              </details>
            )}
          </div>
        )}

        {screen === "orders" && <OrdersBoard />}

        {screen === "assistant" &&
          (assistantPending ? (
            <section
              role="status"
              aria-busy="true"
              aria-label="Loading the assistant"
              className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-6"
            >
              <span className="sr-only">Loading the assistant…</span>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full" />
            </section>
          ) : featureFlags.assistant ? (
            <AssistantPanel
              signedIn={signedIn}
              sessionPending={sessionPending}
              proposalsEnabled={featureFlags.assistantProposals}
              menusLoading={libraryLoading}
              menus={menus
                .filter((menu) => serverIds.has(menu.id) && !staffMenus.has(menu.id))
                .map((menu) => ({ id: menu.id, title: menu.title }))}
            />
          ) : !signedIn ? (
            // Unreachable through the UI — both navs hide the assistant when
            // signed out and the effect below bounces a typed /assistant URL
            // back to capture — so render nothing while the bounce lands.
            null
          ) : (
            <section className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
              <h1 className="font-medium text-stone-900">Assistant isn’t available</h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
                The assistant isn’t released to this account yet. Everything else in Eateryo works
                as usual.
              </p>
              <button
                type="button"
                onClick={() => navigateTo({ screen: "capture" })}
                className="mt-4 rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                Back to capture
              </button>
            </section>
          ))}

        {screen === "tables" && (
          <RestaurantTables signedIn={signedIn} sessionPending={sessionPending} />
        )}

        {screen === "settings" && (
          <RestaurantSettings
            signedIn={signedIn}
            sessionPending={sessionPending}
            currentUserId={session?.user?.id ?? null}
          />
        )}

        {screen === "editor" && activeDoc && (
          <>
            {conflict && (
              <ConflictBanner
                serverUpdatedAt={conflict.serverUpdatedAt}
                error={conflictError}
                onReloadServer={() => void handleLoadServerVersion()}
                onKeepMine={() => void handleKeepMyVersion()}
              />
            )}
            {activeMenuIsStaff && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                You have staff access to this restaurant — menus are view-only for staff. Ask an
                owner to make changes.
              </p>
            )}
            {editorMode === "publish" && !activeMenuIsStaff ? (
              <PublishWizard
                key={activeDoc.id}
                doc={activeDoc}
                signedIn={signedIn}
                sessionPending={sessionPending}
                accountKey={accountKey}
                ownedRestaurants={ownedRestaurantsForAccount}
                restaurantsLoading={restaurantsLoading}
                onPublished={handleWizardPublished}
                onBack={() => navigateTo({ screen: "editor", menuId: activeDoc.id, mode: "edit" })}
                onOpenTables={() => navigateTo({ screen: "tables" })}
                onOpenEditor={() =>
                  navigateTo({ screen: "editor", menuId: activeDoc.id, mode: "edit" })
                }
              />
            ) : (
              <MenuEditor
                doc={activeDoc}
                selectedItemId={selectedItemId}
                mode={activeMenuIsStaff ? "preview" : editorMode}
                onModeChange={(mode) =>
                  navigateTo({ screen: "editor", menuId: activeDoc.id, mode })
                }
                onChange={handleDocChange}
                saveState={saveState}
                syncMode={signedIn ? "account" : "local"}
                canManage={!activeMenuIsStaff}
                onServer={serverIds.has(activeDoc.id)}
                onStartPublish={() =>
                  navigateTo({ screen: "editor", menuId: activeDoc.id, mode: "publish" })
                }
                imageUrl={editorImageUrl}
                onExportJson={handleExportJson}
                onExportCsv={handleExportCsv}
                onImportFile={(f) => void handleImportFile(f)}
                importError={importError}
                onDeleteMenu={() => void handleDeleteMenu(activeDoc.id)}
                onBack={() => void handleBackToLibrary()}
                publishing={{
                  status: activePublication,
                  loaded: activePublicationLoaded,
                  busy: publishBusy,
                  error: publishError,
                  inAccount: serverIds.has(activeDoc.id),
                  onPublish: (theme, layout) => void handlePublish(theme, layout),
                  onUnpublish: () => void handleUnpublish(),
                  onChangeSlug: (slug) => void handleChangeSlug(slug),
                }}
                onPreviewOpen={() => {
                  if (docRef.current) void refreshPublication(docRef.current.id);
                }}
              />
            )}
          </>
        )}

        {screen === "capture" && (
          <>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                Turn your photo into a menu
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600 sm:text-base">
                Upload a photo or scan of a menu, extract it into categories and items with AI, then
                review and correct the draft. AI output is never guaranteed — you stay in charge.
              </p>
            </div>

            <ol aria-label="Progress" className="flex items-center gap-2">
              {STEPS.map((label, index) => (
                <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
                  <span
                    aria-current={index === activeStep ? "step" : undefined}
                    className={[
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      index <= activeStep
                        ? "bg-amber-700 text-white"
                        : "bg-stone-200 text-stone-500",
                    ].join(" ")}
                  >
                    {index + 1}
                  </span>
                  <span
                    className={`text-xs font-medium sm:text-sm ${index <= activeStep ? "text-stone-900" : "text-stone-400"}`}
                  >
                    {label}
                  </span>
                  {index < STEPS.length - 1 && (
                    <span aria-hidden="true" className="h-px flex-1 bg-stone-200" />
                  )}
                </li>
              ))}
            </ol>

            {phase === "upload" && pages.length === 0 && (
              <div className="flex flex-col gap-3">
                <Dropzone onSelect={selectFiles} />
                {fileError && (
                  <p
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                  >
                    {fileError}
                  </p>
                )}
                <p className="text-center text-sm text-stone-500">
                  No menu handy?{" "}
                  <button
                    type="button"
                    onClick={handleDemo}
                    className="font-medium text-amber-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                  >
                    Preview with demo data
                  </button>
                </p>
              </div>
            )}

            {pages.length > 0 && (
              <div className="flex flex-col gap-4">
                <ImagePreview
                  pages={pages}
                  onAdd={() => addInputRef.current?.click()}
                  onReplace={(index) => {
                    replaceIndexRef.current = index;
                    replaceInputRef.current?.click();
                  }}
                  onRemove={removePage}
                />
                <input
                  ref={addInputRef}
                  type="file"
                  multiple
                  accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    const added = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (added.length > 0) addPages(added);
                  }}
                />
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept={SUPPORTED_IMAGE_MIME_TYPES.join(",")}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    const next = event.target.files?.[0];
                    const index = replaceIndexRef.current;
                    event.target.value = "";
                    replaceIndexRef.current = null;
                    if (next && index !== null) replacePageAt(index, next);
                  }}
                />
                {fileError && (
                  <p
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                  >
                    {fileError}
                  </p>
                )}
                <div>
                  <button
                    type="button"
                    onClick={handleExtract}
                    disabled={phase === "extracting"}
                    className="w-full rounded-full bg-amber-700 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 sm:w-auto"
                  >
                    {phase === "extracting"
                      ? "Extracting… this can take up to a minute"
                      : "Extract menu"}
                  </button>
                  <p className="mt-2 text-xs text-stone-500">
                    Calls the AI once, only when you press this. Accuracy depends on image quality.
                  </p>
                </div>
              </div>
            )}

            {phase === "extracting" && extractProgress && (
              <ExtractionProgress
                pageCount={extractProgress.pageCount}
                preparedPages={extractProgress.preparedPages}
                requestStartedAt={extractProgress.requestStartedAt}
              />
            )}

            {extractError && phase !== "extracting" && (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
                <p className="font-medium text-red-900">Extraction failed</p>
                <p className="mt-1 text-sm text-red-800">{extractError.message}</p>
                {extractError.code === "missing_api_key" && (
                  <button
                    type="button"
                    onClick={handleDemo}
                    className="mt-3 rounded-full bg-red-800 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                  >
                    Preview with demo data instead
                  </button>
                )}
              </div>
            )}

            {result && (
              <div ref={resultRef}>
                <ExtractionResult
                  data={result}
                  source={source}
                  onStartOver={clearCapture}
                  onEdit={() => void handleEditResult()}
                  onPublish={
                    source === "demo" || draftSave === "saved"
                      ? () => void handleStartPublish()
                      : undefined
                  }
                  previewDoc={resultDoc}
                  savedNotice={
                    source === "ai" && draftSave === "saved"
                      ? "Draft saved to My menus"
                      : source === "ai" && draftSave === "saving"
                        ? "Saving draft…"
                        : null
                  }
                  editLabel={
                    source === "ai"
                      ? draftSave === "saved"
                        ? "Open in editor"
                        : "Edit menu"
                      : "Save & open editor"
                  }
                />
              </div>
            )}
          </>
        )}
        {screen === "editor" && !activeDoc && (
          <div role="status" aria-busy="true" className="flex flex-col gap-4">
            <span className="sr-only">Opening menu…</span>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
                <Skeleton className="mt-3 h-28" />
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-2 h-3 w-3/5" />
                <Skeleton className="mt-4 h-9" />
              </div>
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
      {/*
        R0 phone nav: bottom tab bar (Capture · My menus · Orders · More).
        Orders stays pinned so the R0.3 order monitor has a persistent home
        for its badge; Tables/Assistant/Settings live in the More sheet and
        each render their own signed-out explanation. Desktop keeps pills.
        Sits after the footer so it is the last thing on the page and sticks
        to the viewport bottom instead of floating above the footer links.
      */}
      <nav
        data-print-hide
        aria-label="Sections"
        className="sticky bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-sm sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-4 px-2 pt-1">
          {phoneTabs().map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMoreOpen(false);
                navigateTo({ screen: tab.id });
              }}
              aria-current={screen === tab.id ? "page" : undefined}
              className={`relative flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 ${
                screen === tab.id ? "text-amber-800" : "text-stone-500"
              }`}
            >
              {tab.id === "orders" && <NewOrdersBadge tone="bar" />}
              <span aria-hidden="true" className="text-lg leading-none">
                {tab.icon}
              </span>
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-current={
              screen === "tables" || screen === "assistant" || screen === "settings"
                ? "page"
                : undefined
            }
            className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 ${
              moreOpen ||
              screen === "tables" ||
              screen === "assistant" ||
              screen === "settings"
                ? "text-amber-800"
                : "text-stone-500"
            }`}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ⋯
            </span>
            More
          </button>
        </div>
      </nav>
      {moreOpen && (
        <div className="sm:hidden">
          <div
            aria-hidden="true"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-black/35"
          />
          <div
            role="dialog"
            aria-label="More"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-stone-200 bg-white px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <div aria-hidden="true" className="mx-auto mb-1 h-1.5 w-11 rounded-full bg-stone-200" />
            {moreSheetRows({ signedIn, assistantEnabled: featureFlags.assistant }).map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  navigateTo({ screen: row.id });
                }}
                className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 text-left transition-colors hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
              >
                <span className="text-sm font-semibold text-stone-900">{row.label}</span>
                <span className="text-xs font-normal text-stone-500">{row.why}</span>
              </button>
            ))}
            <a
              href="/launch"
              className="flex min-h-[52px] w-full flex-col justify-center rounded-xl px-2 transition-colors hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <span className="text-sm font-semibold text-stone-900">Get started</span>
              <span className="text-xs font-normal text-stone-500">
                The launch checklist and offer
              </span>
            </a>
          </div>
        </div>
      )}
      <MonitorToastStack onOpen={() => navigateTo({ screen: "orders" })} />
    </div>
    </OrderMonitorProvider>
  );
}
