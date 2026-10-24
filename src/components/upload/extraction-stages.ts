/**
 * Stage labels for the extraction wait.
 *
 * The API is one request: there is no per-page progress to subscribe to. The
 * only real milestones are the client-side image preparation and the moment
 * the response arrives, so the time-based labels below are explicitly
 * approximations. They keep the wait moving without claiming that the AI has
 * finished a step it has not.
 */

export type ExtractionStage = "preparing" | "reading" | "building" | "waiting";

/** Seconds after the request starts before the copy says the draft is forming. */
export const BUILDING_AFTER_SECONDS = 12;

/** Seconds after which the copy stops estimating and just says it is slow. */
export const WAITING_AFTER_SECONDS = 30;

export const EXTRACTION_STAGE_COPY: Record<ExtractionStage, { label: string; detail: string }> = {
  preparing: {
    label: "Preparing your photos",
    detail: "Getting each page ready to send.",
  },
  reading: {
    label: "Reading your menu",
    detail: "The AI is reading every page together.",
  },
  building: {
    label: "Building your draft",
    detail: "Turning what it read into sections, items and prices.",
  },
  waiting: {
    label: "Still working",
    detail: "Large or blurry menus take longer. Up to a minute is normal.",
  },
};

export interface ExtractionClock {
  /** Epoch ms when the request left the browser; null while preparing. */
  requestStartedAt: number | null;
  /** Epoch ms used to measure elapsed time. */
  now: number;
}

export function extractionStage({ requestStartedAt, now }: ExtractionClock): ExtractionStage {
  if (requestStartedAt === null) return "preparing";
  const seconds = Math.max(0, now - requestStartedAt) / 1000;
  if (seconds < BUILDING_AFTER_SECONDS) return "reading";
  if (seconds < WAITING_AFTER_SECONDS) return "building";
  return "waiting";
}

/**
 * A visual-only fraction for the progress bar. It is capped below 1 so the
 * bar never claims the work is finished before the result actually arrives.
 */
export function extractionProgressFraction({
  requestStartedAt,
  now,
  preparedPages,
  pageCount,
}: ExtractionClock & { preparedPages: number; pageCount: number }): number {
  if (requestStartedAt === null) {
    if (pageCount <= 0) return 0.05;
    return 0.05 + Math.min(1, preparedPages / pageCount) * 0.1;
  }
  const seconds = Math.max(0, now - requestStartedAt) / 1000;
  return Math.min(0.95, 0.15 + Math.min(seconds, 60) * (0.8 / 60));
}
