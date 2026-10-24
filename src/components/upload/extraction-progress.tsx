"use client";

/**
 * The wait between pressing "Extract menu" and seeing the draft.
 *
 * A single server request can take up to a minute, so the panel shows every
 * real milestone it has (page preparation, the request starting) and changes
 * its wording over time while the AI works. It never shows a percentage or a
 * finished step the browser cannot observe.
 *
 * The second column answers the question a first-time owner actually has at
 * this point — "what is this going to give me?" — instead of leaving a silent
 * spinner on screen.
 */

import { useEffect, useState } from "react";

import {
  EXTRACTION_STAGE_COPY,
  extractionProgressFraction,
  extractionStage,
} from "./extraction-stages";

export interface ExtractionProgressProps {
  pageCount: number;
  preparedPages: number;
  /** Epoch ms when the request started; null while images are prepared. */
  requestStartedAt: number | null;
}

const NEXT_STEPS = [
  {
    title: "A draft you check",
    body: "Sections, items and prices arrive in an editor. Anything unclear is flagged instead of guessed.",
  },
  {
    title: "Saved in this browser",
    body: "No account needed. The draft waits in My menus on this device.",
  },
  {
    title: "Your link, when ready",
    body: "After you review it, one short form gives you a public link. Table QR codes are one step after that.",
  },
] as const;

export function ExtractionProgress({
  pageCount,
  preparedPages,
  requestStartedAt,
}: ExtractionProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (requestStartedAt === null) return;
    // Subscribe to the clock; the first tick lands within a second, and the
    // stale `now` before it is clamped to zero elapsed by `extractionStage`.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [requestStartedAt]);

  const stage = extractionStage({ requestStartedAt, now });
  const copy = EXTRACTION_STAGE_COPY[stage];
  const elapsed =
    requestStartedAt === null ? 0 : Math.max(0, Math.round((now - requestStartedAt) / 1000));
  const fraction = extractionProgressFraction({
    requestStartedAt,
    now,
    preparedPages,
    pageCount,
  });

  const photosReady = requestStartedAt !== null;
  const photoLabel = pageCount === 1 ? "1 page photo" : `${pageCount} page photos`;

  return (
    <section
      aria-label="Extraction progress"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div
        role="status"
        aria-busy="true"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-amber-700 border-t-transparent"
          />
          <div className="min-w-0">
            <p
              aria-hidden="true"
              className="text-[11px] font-semibold tracking-[0.18em] text-amber-800 uppercase"
            >
              {requestStartedAt === null ? "Preparing" : `Working · ${elapsed}s`}
            </p>
            <h2 className="mt-1 text-base font-bold text-amber-950">{copy.label}</h2>
          </div>
        </div>

        <p className="mt-2 text-sm leading-6 text-amber-900">{copy.detail}</p>

        <div aria-hidden="true" className="mt-4 h-1.5 overflow-hidden rounded-full bg-amber-200">
          <div
            className="h-full rounded-full bg-amber-700 transition-[width] duration-700"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>

        <ol aria-label="Extraction steps" className="mt-4 flex flex-wrap gap-1.5">
          <li className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-amber-900">
            {photosReady ? (
              <span aria-hidden="true">✓</span>
            ) : (
              <span
                aria-hidden="true"
                className="h-2 w-2 animate-pulse rounded-full bg-amber-700"
              />
            )}
            {photosReady
              ? photoLabel
              : preparedPages > 0
                ? `Preparing ${preparedPages} of ${pageCount}`
                : "Preparing photos"}
          </li>
          <li
            aria-current="step"
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-700 px-2.5 py-1 text-[11px] font-semibold text-white"
          >
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Read &amp; draft
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full bg-white/50 px-2.5 py-1 text-[11px] font-medium text-amber-800/70">
            <span aria-hidden="true" className="h-2 w-2 rounded-full border border-amber-700/40" />
            Save
          </li>
        </ol>

        <p className="mt-4 text-xs leading-5 text-amber-800">
          Keep this tab open. The images are processed in memory and never stored on our server.
        </p>
      </div>

      <aside className="rounded-2xl border border-stone-200 bg-white p-5">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-amber-800 uppercase">
          While you wait
        </p>
        <h2 className="mt-1 text-base font-bold text-stone-900">What happens next</h2>
        <ol className="mt-3 space-y-3">
          {NEXT_STEPS.map((step, index) => (
            <li key={step.title} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-[11px] font-bold text-amber-800"
              >
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-stone-900">{step.title}</p>
                <p className="text-xs leading-5 text-stone-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
