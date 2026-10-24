import { describe, expect, it } from "vitest";

import {
  BUILDING_AFTER_SECONDS,
  WAITING_AFTER_SECONDS,
  extractionProgressFraction,
  extractionStage,
} from "../src/components/upload/extraction-stages";

const start = 1_000_000;

describe("extraction stages", () => {
  it("prepares before the request starts, regardless of the clock", () => {
    expect(extractionStage({ requestStartedAt: null, now: start + 60_000 })).toBe("preparing");
  });

  it("moves from reading to building to waiting on elapsed time", () => {
    expect(extractionStage({ requestStartedAt: start, now: start + 1_000 })).toBe("reading");
    expect(
      extractionStage({
        requestStartedAt: start,
        now: start + BUILDING_AFTER_SECONDS * 1000,
      })
    ).toBe("building");
    expect(
      extractionStage({
        requestStartedAt: start,
        now: start + WAITING_AFTER_SECONDS * 1000,
      })
    ).toBe("waiting");
  });

  it("treats clock skew before the start as zero elapsed", () => {
    expect(extractionStage({ requestStartedAt: start, now: start - 5_000 })).toBe("reading");
  });

  it("advances the visual fraction while preparing and during the request", () => {
    const preparing = extractionProgressFraction({
      requestStartedAt: null,
      now: start,
      preparedPages: 0,
      pageCount: 2,
    });
    const halfPrepared = extractionProgressFraction({
      requestStartedAt: null,
      now: start,
      preparedPages: 1,
      pageCount: 2,
    });
    expect(halfPrepared).toBeGreaterThan(preparing);

    const reading = extractionProgressFraction({
      requestStartedAt: start,
      now: start + 5_000,
      preparedPages: 2,
      pageCount: 2,
    });
    const later = extractionProgressFraction({
      requestStartedAt: start,
      now: start + 40_000,
      preparedPages: 2,
      pageCount: 2,
    });
    expect(later).toBeGreaterThan(reading);
    expect(later).toBeLessThan(1);
  });

  it("never reaches completion before the result arrives", () => {
    expect(
      extractionProgressFraction({
        requestStartedAt: start,
        now: start + 60 * 60 * 1000,
        preparedPages: 2,
        pageCount: 2,
      })
    ).toBeLessThan(1);
  });
});
