"use client";

import { useEffect, useRef, useState } from "react";

import { SiteHeader } from "@/components/layout/site-header";
import { LibraryPanel } from "@/components/menu-editor/library-panel";
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
import { createMenuDocument } from "@/features/menu/menu-utils";
import type { MenuDocument } from "@/features/menu/schema";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import {
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
import type { ExtractedMenu } from "@/lib/ai/extraction-schema";
import { ExtractClientError, extractMenuFromFiles } from "@/lib/extract-client";
import { validateImageBatch } from "@/lib/image-constraints";

type Screen = "capture" | "library" | "editor";
type Phase = "upload" | "ready" | "extracting" | "done";

const STEPS = ["Upload image", "Extract menu", "Review draft"] as const;

function stepIndex(phase: Phase, hasResult: boolean): number {
  if (hasResult || phase === "done") return 2;
  if (phase === "ready" || phase === "extracting") return 1;
  return 0;
}

export default function Home() {
  // Capture flow state.
  const [screen, setScreen] = useState<Screen>("capture");
  const [pages, setPages] = useState<PageImage[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [extracted, setExtracted] = useState<ExtractedMenu | null>(null);
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

  const result: PreviewMenu | null = extracted ?? demoDoc;

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

  // --- Autosave -----------------------------------------------------------

  async function doSave() {
    const doc = docRef.current;
    if (!doc || storageDownRef.current) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedRef.current) {
      setSaveState({ kind: "saved", message: "Saved locally" });
      return;
    }
    try {
      const saved = await saveMenu(doc);
      lastSavedRef.current = JSON.stringify(saved);
      setSaveState({
        kind: "saved",
        message: `Saved locally · ${new Date(saved.updatedAt).toLocaleTimeString()}`,
      });
      setMenus(await listMenus());
    } catch (error) {
      setSaveState({
        kind: "error",
        message:
          error instanceof StorageError ? error.message : "Save failed — edits are kept in memory.",
      });
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

  async function openDoc(doc: MenuDocument, imageBlob: Blob | null) {
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
    setScreen("editor");
  }

  // --- Library actions ----------------------------------------------------

  async function handleOpenMenu(id: string) {
    setLibraryError(null);
    try {
      const doc = await getMenu(id);
      let blob: Blob | null = null;
      try {
        blob = (await getImage(id))?.blob ?? null;
      } catch {
        blob = null; // Image is optional; the menu matters.
      }
      await openDoc(doc, blob);
    } catch (error) {
      setLibraryError(error instanceof StorageError ? error.message : "Could not open that menu.");
    }
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

  async function handleDeleteMenu(id: string) {
    try {
      await deleteMenu(id);
      if (docRef.current?.id === id) {
        docRef.current = null;
        lastSavedRef.current = null;
        setActiveDoc(null);
        setEditorImage(null);
      }
      await refreshLibrary();
      setScreen("library");
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
    setScreen("library");
  }

  // --- Capture flow -------------------------------------------------------

  function scrollToResult() {
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  function confirmDiscard(): boolean {
    if (!extracted && !demoDoc) return true;
    return window.confirm("This will discard the current extracted menu. Continue?");
  }

  /**
   * Swap the whole selection for `nextFiles`: release old preview URLs,
   * show the new ones, and drop any stale extraction result. Callers have
   * already confirmed discarding and validated the batch.
   */
  function applySelection(nextFiles: File[]) {
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

  /** Append pages to the current selection; the whole set is validated as one batch. */
  function addPages(incoming: File[]) {
    if (incoming.length === 0) return;
    if (!confirmDiscard()) return;
    const combined = [...pages.map((page) => page.file), ...incoming];
    const check = validateImageBatch(combined);
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    applySelection(combined);
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

  async function handleExtract() {
    if (pages.length === 0 || phase === "extracting") return;
    setPhase("extracting");
    setFileError(null);
    setExtractError(null);
    try {
      const menu = await extractMenuFromFiles(pages.map((page) => page.file));
      setExtracted(menu);
      setSource("ai");
      setPhase("done");
    } catch (error) {
      setExtractError(
        error instanceof ExtractClientError
          ? error
          : new ExtractClientError("internal_error", "Something went wrong. Try again.")
      );
      setPhase("ready");
    }
    scrollToResult();
  }

  function handleDemo() {
    if (!confirmDiscard()) return;
    clearCapture();
    setDemoDoc(createSampleMenuDocument());
    setSource("demo");
    setPhase("done");
    scrollToResult();
  }

  /** Save the current result (AI or demo) and open it in the editor. */
  async function handleEditResult() {
    try {
      if (source === "ai" && extracted) {
        const firstPage = pages[0];
        const doc = extractedMenuToDocument(extracted, {
          provider: "gemini",
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
      setScreen("editor");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import that file.");
    }
  }

  const activeStep = stepIndex(phase, result !== null);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        {screen !== "editor" && (
          <nav aria-label="Sections" className="flex gap-2">
            {(
              [
                { id: "capture", label: "Capture" },
                { id: "library", label: `My menus${menus.length ? ` (${menus.length})` : ""}` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScreen(tab.id)}
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
            <LibraryPanel
              menus={menus}
              activeId={activeDoc?.id ?? null}
              unavailable={storageDown}
              onOpen={(id) => void handleOpenMenu(id)}
              onNew={() => void handleNewMenu()}
              onRename={(id, title) => void handleRenameMenu(id, title)}
              onDelete={(id) => void handleDeleteMenu(id)}
            />
          </div>
        )}

        {screen === "editor" && activeDoc && (
          <MenuEditor
            doc={activeDoc}
            onChange={handleDocChange}
            saveState={saveState}
            imageUrl={editorImageUrl}
            onExportJson={handleExportJson}
            onExportCsv={handleExportCsv}
            onImportFile={(f) => void handleImportFile(f)}
            importError={importError}
            onDeleteMenu={() => void handleDeleteMenu(activeDoc.id)}
            onBack={() => void handleBackToLibrary()}
          />
        )}

        {screen === "capture" && (
          <>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
                Turn a menu photo into structured data
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
                  No menu handy, or no API key configured?{" "}
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
                  accept="image/jpeg,image/png,image/webp"
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
                  accept="image/jpeg,image/png,image/webp"
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
                />
              </div>
            )}
          </>
        )}

        <footer className="mt-auto border-t border-stone-200 pt-4 pb-2">
          <p className="text-xs leading-5 text-stone-500">
            Local-first prototype: uploaded images are processed in memory and never stored on the
            server. Saved menus live in this browser only — export JSON backups of anything
            important.
          </p>
        </footer>
      </main>
    </div>
  );
}
