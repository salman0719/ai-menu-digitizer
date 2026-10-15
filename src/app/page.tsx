"use client";

import { useEffect, useRef, useState } from "react";

import { SiteHeader } from "@/components/layout/site-header";
import { Dropzone } from "@/components/upload/dropzone";
import { ExtractionResult, PreviewMenu } from "@/components/upload/extraction-result";
import { ImagePreview } from "@/components/upload/image-preview";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { ExtractClientError, extractMenuFromFile } from "@/lib/extract-client";
import { validateImageFile } from "@/lib/image-constraints";

type Phase = "upload" | "ready" | "extracting" | "done";

const STEPS = ["Upload image", "Extract menu", "Review draft"] as const;

function stepIndex(phase: Phase, hasResult: boolean): number {
  if (hasResult || phase === "done") return 2;
  if (phase === "ready" || phase === "extracting") return 1;
  return 0;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [result, setResult] = useState<PreviewMenu | null>(null);
  const [source, setSource] = useState<"ai" | "demo">("ai");
  const [extractError, setExtractError] = useState<ExtractClientError | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function scrollToResult() {
    // Let state paint first.
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  function confirmDiscard(): boolean {
    if (!result) return true;
    return window.confirm("This will discard the current extracted menu. Continue?");
  }

  function selectFile(next: File) {
    if (!confirmDiscard()) return;
    const check = validateImageFile(next);
    if (!check.valid) {
      setFileError(check.message);
      return;
    }
    setFileError(null);
    setExtractError(null);
    setResult(null);
    setFile(next);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(next);
    });
    setPhase("ready");
  }

  function clearAll() {
    setFile(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setFileError(null);
    setExtractError(null);
    setResult(null);
    setPhase("upload");
  }

  function handleRemove() {
    if (!confirmDiscard()) return;
    clearAll();
  }

  async function handleExtract() {
    if (!file || phase === "extracting") return;
    setPhase("extracting");
    setExtractError(null);
    try {
      const menu = await extractMenuFromFile(file);
      setResult(menu);
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
    clearAll();
    setResult(createSampleMenuDocument());
    setSource("demo");
    setPhase("done");
    scrollToResult();
  }

  const activeStep = stepIndex(phase, result !== null);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
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
                  index < activeStep
                    ? "bg-amber-700 text-white"
                    : index === activeStep
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

        {phase === "upload" && !file && (
          <div className="flex flex-col gap-3">
            <Dropzone onSelect={selectFile} />
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

        {file && previewUrl && (
          <div className="flex flex-col gap-4">
            <ImagePreview
              file={file}
              previewUrl={previewUrl}
              onReplace={() => replaceInputRef.current?.click()}
              onRemove={handleRemove}
            />
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) selectFile(next);
                event.target.value = "";
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
              Reading your menu… keep this tab open. The image is processed in memory and never
              stored on the server.
            </p>
          </div>
        )}

        {extractError && phase !== "extracting" && (
          <div
            ref={extractError.code === "missing_api_key" ? undefined : resultRef}
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4"
          >
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
            <ExtractionResult data={result} source={source} onStartOver={clearAll} />
          </div>
        )}

        <footer className="mt-auto border-t border-stone-200 pt-4 pb-2">
          <p className="text-xs leading-5 text-stone-500">
            Local-first prototype: uploaded images are processed in memory and never stored on the
            server. Extracted data is an AI draft — always review prices and names.
          </p>
        </footer>
      </main>
    </div>
  );
}
