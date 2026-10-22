"use client";

import { useEffect, useRef, useState } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ConflictBanner } from "@/components/menu-editor/conflict-banner";
import { LibraryPanel } from "@/components/menu-editor/library-panel";
import { MoveToAccountPanel } from "@/components/menu-editor/move-to-account-panel";
import { RestaurantSettings } from "@/components/settings/restaurant-settings";
import { RestaurantTables } from "@/components/tables/restaurant-tables";
import { OrdersBoard } from "@/components/orders/orders-board";
import { MenuEditor, SaveState } from "@/components/menu-editor/menu-editor";
import { Dropzone } from "@/components/upload/dropzone";
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
import type { PublicationStatus } from "@/features/publishing/schema";
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
  parseAppRoute,
  type AppRoute,
  type AppScreen,
  type EditorMode,
} from "@/features/navigation/routes";
import { staffMenuIds } from "@/features/tenancy/access";
import { fetchRestaurants, type RestaurantOption } from "@/features/tenancy/client";
import { moveLocalMenuToAccount } from "@/features/menus/move-to-account";

type Phase = "upload" | "ready" | "extracting" | "done";

const STEPS = ["Upload image", "Extract menu", "Review draft"] as const;

function routeMenuId(route: AppRoute): string | null {
  return route.screen === "editor" || route.screen === "item" ? route.menuId : null;
}

function stepIndex(phase: Phase, hasResult: boolean): number {
  if (hasResult || phase === "done") return 2;
  if (phase === "ready" || phase === "extracting") return 1;
  return 0;
}

export default function Home() {
  // The URL is the source of truth for the main screen and selected menu.
  // Start on capture for SSR, then hydrate the route from location in an effect.
  const [route, setRoute] = useState<AppRoute>({ screen: "capture" });
  const screen: AppScreen = route.screen === "item" ? "editor" : route.screen;
  const selectedItemId = route.screen === "item" ? route.itemId : null;
  // Which editor surface the URL asks for (edit, reorder, table QR,
  // preview); an item deep link is always the edit workspace.
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

  // Native History API is integrated with Next's App Router; subscribe to
  // browser back/forward so the visible screen follows the URL without reload.
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
  }, []);

  const [pages, setPages] = useState<PageImage[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [extracted, setExtracted] = useState<MenuExtractionResult | null>(null);
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
  const [storageDown, setStorageDown] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<MenuDocument | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({
    kind: "saved",
    message: "Saved locally",
  });
  const [importError, setImportError] = useState<string | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const replaceIndexRef = useRef<number | null>(null);
  /** Preview URLs currently shown for `pages` (revoked on swap and unmount). */
  const liveUrlsRef = useRef<string[]>([]);
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
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (!cancelled) setOwnedRestaurants(list.filter((r) => r.role === "owner"));
      } catch {
        // Best-effort: the move panel shows its own load error, and the
        // server still refuses a move the caller may not make.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

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

  useEffect(() => {
    if (!navigationReadyRef.current || !routeMenuId(route) || sessionPending) return;
    const menuId = routeMenuId(route);
    if (!menuId) return;
    if (activeDocIdRef.current === menuId) {
      openedRouteMenuRef.current = menuId;
      return;
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
      return;
    }
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
      setSaveState({
        kind: "saved",
        message: serverBaseRef.current ? "Synced with your account" : "Saved locally",
      });
      return;
    }
    try {
      const saved = await saveMenu(doc);
      lastSavedRef.current = JSON.stringify(saved);
      setMenus(await listMenus());
      if (!(await pushToAccount(saved))) {
        setSaveState({
          kind: "saved",
          message: conflictRef.current
            ? "Saved locally · resolve “changed elsewhere” above"
            : `Saved locally · ${new Date(saved.updatedAt).toLocaleTimeString()}`,
        });
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
   * the save stays local-only — signed out, menu not moved to the account
   * yet, or a conflict awaiting an explicit decision — in which case the
   * caller sets the local status message. Otherwise the save state is set
   * here and true is returned.
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
      setSaveState({
        kind: "saved",
        message: `Saved to your account · ${new Date(pushed.updatedAt).toLocaleTimeString()}`,
      });
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
          message: "Changed elsewhere — choose which version wins above.",
        });
        return true;
      }
      if (error instanceof SyncError && error.code === "unauthorized") {
        serverBaseRef.current = null;
        setSaveState({ kind: "saved", message: "Saved locally · sign in again to sync" });
        return true;
      }
      if (error instanceof SyncError && error.code === "forbidden") {
        serverBaseRef.current = null;
        setSaveState({
          kind: "saved",
          message: "Saved locally · you don't have write access to this account's menus",
        });
        return true;
      }
      if (error instanceof SyncError && error.code === "not_found") {
        serverBaseRef.current = null;
        removeServerId(saved.id);
        setSaveState({ kind: "saved", message: "Saved locally · the account copy was removed" });
        return true;
      }
      // Offline / server down: the local copy is safe and retried next save.
      setSaveState({ kind: "saved", message: "Saved locally · account sync unavailable" });
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
        : { kind: "saved", message: "Saved locally" }
    );
    setImportError(null);
    setEditorImage(imageBlob ? URL.createObjectURL(imageBlob) : null);
    if (updateRoute) navigateTo({ screen: "editor", menuId: doc.id, mode: "edit" });
    void syncWithAccount(doc);
  }

  /**
   * Reconcile a just-opened menu with the account (signed in only). The
   * account is authoritative: when it holds a different revision, adopt it
   * and keep IndexedDB in step as the cache. Menus that were never moved to
   * the account stay local-only — "Move my menus to my account" is the
   * explicit path for those.
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
        setSaveState({ kind: "saved", message: "Loaded the account version" });
        await refreshLibrary();
        return;
      }
      setSaveState({ kind: "saved", message: "Synced with your account" });
    } catch (error) {
      if (docRef.current?.id !== localDoc.id) return;
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(localDoc.id);
        setSaveState({ kind: "saved", message: "Saved locally · not in your account yet" });
        return;
      }
      if (error instanceof SyncError && error.code === "unauthorized") {
        setSaveState({ kind: "saved", message: "Saved locally · sign in again to sync" });
        return;
      }
      setSaveState({ kind: "saved", message: "Saved locally · account sync unavailable" });
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
      setSaveState({ kind: "saved", message: "Loaded the account version" });
      await refreshLibrary();
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        conflictRef.current = { serverUpdatedAt: null };
        setConflict({ serverUpdatedAt: null });
        setConflictError("The account copy no longer exists — keeping your version is safe.");
        return;
      }
      setConflictError("Could not load the account version. Check your connection and try again.");
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
      setSaveState({
        kind: "saved",
        message: `Saved to your account · ${new Date(pushed.updatedAt).toLocaleTimeString()}`,
      });
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
          "The account copy was removed — your version stays saved in this browser."
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
            "Renamed in this browser — the account copy changed elsewhere. Open the menu to reconcile."
          );
        } else if (error instanceof SyncError && error.code === "forbidden") {
          setLibraryError(
            "Renamed in this browser — only the restaurant owner can change the account copy."
          );
        } else if (error instanceof SyncError && error.code === "unauthorized") {
          setLibraryError("Renamed in this browser — sign in again to update the account copy.");
        } else {
          setLibraryError(
            "Renamed in this browser — the account copy could not be updated. Try again when online."
          );
        }
      }
    } catch (error) {
      if (error instanceof SyncError && error.code === "not_found") {
        removeServerId(renamed.id);
        return;
      }
      setLibraryError(
        "Renamed in this browser — the account copy could not be reached. Try again when online."
      );
    }
  }

  /**
   * Move one browser-only menu into an owned restaurant. The library row
   * shows the returned message on failure; success marks the row as on the
   * account right away, then reconciles with the server list.
   */
  async function handleMoveMenuToAccount(
    menuId: string,
    restaurantId: string
  ): Promise<string | null> {
    const title = menus.find((menu) => menu.id === menuId)?.title ?? "That menu";
    const outcome = await moveLocalMenuToAccount(restaurantId, menuId);
    if (outcome.status === "failed") {
      return `“${title}” could not be moved — ${outcome.reason}`;
    }
    addServerId(menuId);
    await mergeAccountMenus();
    return null;
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
          return "The account copy of this menu no longer exists. Open it again to reconcile.";
        case "slug_taken":
          return "That link is already used by another menu — pick another address.";
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
        setPublishError("Move this menu to your account first, then publish it.");
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

  async function handleDeleteMenu(id: string) {
    try {
      // Remove the account copy first when there is one, so a failure is
      // reported before the local menu is gone. The local delete always
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
              "Deleted from this browser — only the restaurant owner can remove the account copy.";
          } else if (error instanceof SyncError && error.code === "unauthorized") {
            accountNote = "Deleted from this browser — sign in again to remove the account copy.";
          } else {
            accountNote =
              "Deleted from this browser — the account copy could not be removed. Try again when online.";
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
    setDemoDoc(null);
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
    try {
      // Normalize first: AVIF is transcoded to JPEG here because the provider
      // cannot read it, and mislabeled files get their real MIME type.
      const prepared = await Promise.all(files.map(prepareImageForUpload));
      const extraction = await extractMenuFromFiles(
        prepared.map((image) => new File([image.blob], image.filename, { type: image.mimeType }))
      );
      setExtracted(extraction);
      setSource("ai");
      setPhase("done");
      void autoSaveDraft(extraction, files[0] ?? null);
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
    setDemoDoc(createSampleMenuDocument());
    setSource("demo");
    setPhase("done");
    scrollToResult();
  }

  /**
   * Persist an extraction immediately, so reviewing the draft in the editor
   * is optional rather than the act of saving. Skips empty results (nothing
   * worth storing) and keeps the newest draft when extractions overlap.
   */
  async function autoSaveDraft(extraction: MenuExtractionResult, primaryPage: File | null) {
    const token = (draftTokenRef.current += 1);
    if (extraction.menu.categories.length === 0) {
      draftDocRef.current = null;
      setDraftSave("idle");
      return;
    }
    const doc = extractedMenuToDocument(extraction.menu, {
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
  async function handleEditResult() {
    try {
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
        await openDoc(saved, firstPage ? firstPage.file : null);
      } else {
        const doc = demoDoc ?? createSampleMenuDocument();
        const saved = storageDownRef.current ? doc : await saveMenu(doc);
        if (!storageDownRef.current) await refreshLibrary();
        await openDoc(saved, null);
      }
    } catch (error) {
      setExtractError(
        new ExtractClientError(
          "internal_error",
          error instanceof StorageError ? error.message : "Could not open the editor. Try again."
        )
      );
      scrollToResult();
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

  // Library rows carry their account state: menus on the server show as
  // synced; the rest are browser-only until moved (or downloaded).
  const libraryMenus = menus.map((menu) => ({ ...menu, onServer: serverIds.has(menu.id) }));
  const localOnly = libraryMenus.filter((menu) => !menu.onServer);
  const localOnlyCount = localOnly.length;
  // A name for the first-run "Name your restaurant" field, guessed from the
  // titles of the menus the move would copy (null when they say nothing).
  const suggestedRestaurantName = suggestRestaurantName(localOnly.map((menu) => menu.title));

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
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main
        className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-8 ${
          // The editor is a dense working surface: give it a wider canvas on
          // large screens. Capture and library stay at a readable measure.
          screen === "editor" ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        {screen !== "editor" && (
          <nav data-print-hide aria-label="Sections" className="flex gap-2">
            {(
              [
                { id: "capture", label: "Capture" },
                { id: "library", label: `My menus${menus.length ? ` (${menus.length})` : ""}` },
                { id: "orders", label: "Orders" },
                // Tables and Settings only apply to accounts (restaurants live there).
                ...(signedIn
                  ? [
                      { id: "tables" as const, label: "Tables" },
                      { id: "settings" as const, label: "Settings" },
                    ]
                  : []),
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
              </button>
            ))}
          </nav>
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
            {signedIn && localOnlyCount > 0 && (
              <MoveToAccountPanel
                menuCount={localOnlyCount}
                suggestedName={suggestedRestaurantName}
                onMoved={() => void mergeAccountMenus()}
                onOwnedChange={setOwnedRestaurants}
              />
            )}
            <LibraryPanel
              menus={libraryMenus}
              accountMode={signedIn}
              ownedRestaurants={signedIn ? ownedRestaurants : []}
              onMoveToAccount={handleMoveMenuToAccount}
              unavailable={storageDown}
              onOpen={(id) => void handleOpenMenu(id)}
              onNew={() => void handleNewMenu()}
              onRename={(id, title) => void handleRenameMenu(id, title)}
              onDelete={(id) => void handleDeleteMenu(id)}
            />
          </div>
        )}

        {screen === "orders" && <OrdersBoard />}

        {screen === "tables" && <RestaurantTables signedIn={signedIn} />}

        {screen === "settings" && (
          <RestaurantSettings signedIn={signedIn} currentUserId={session?.user?.id ?? null} />
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
            <MenuEditor
              doc={activeDoc}
              selectedItemId={selectedItemId}
              onOpenItem={(itemId) => navigateTo({ screen: "item", menuId: activeDoc.id, itemId })}
              mode={activeMenuIsStaff ? "preview" : editorMode}
              onModeChange={(mode) => navigateTo({ screen: "editor", menuId: activeDoc.id, mode })}
              onChange={handleDocChange}
              saveState={saveState}
              syncMode={signedIn ? "account" : "local"}
              canManage={!activeMenuIsStaff}
              onServer={serverIds.has(activeDoc.id)}
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

            {phase === "extracting" && (
              <div
                role="status"
                className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"
              >
                <span
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-amber-700 border-t-transparent"
                />
                <p className="text-sm text-amber-900">
                  {pages.length > 1
                    ? `Reading ${pages.length} pages… keep this tab open.`
                    : "Reading your menu… keep this tab open."}{" "}
                  The {pages.length > 1 ? "images are" : "image is"} processed in memory and never
                  stored on the server.
                </p>
              </div>
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
          <p role="status" className="text-sm text-stone-500">
            Opening menu…
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
