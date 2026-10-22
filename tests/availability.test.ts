import { describe, expect, it } from "vitest";

import { isMenuOpenAt } from "@/features/availability/open-at";
import { menuAvailabilitySchema } from "@/features/availability/schema";

/**
 * Step 1 — menu opening windows. Empty means "always open" (the default);
 * anything else is a half-open [start, end) range on the listed weekdays,
 * with `end <= start` crossing midnight into the next calendar day.
 */

// Monday 2026-10-19 12:00 UTC.
const MON_NOON_UTC = new Date("2026-10-19T12:00:00.000Z");
// Monday 2026-10-19 08:59 / 09:00 / 17:00 UTC (boundary probes).
const MON_0859_UTC = new Date("2026-10-19T08:59:00.000Z");
const MON_0900_UTC = new Date("2026-10-19T09:00:00.000Z");
const MON_1700_UTC = new Date("2026-10-19T17:00:00.000Z");
// Sunday night / Monday early morning UTC (overnight probes).
const SUN_2330_UTC = new Date("2026-10-18T23:30:00.000Z");
const MON_0130_UTC = new Date("2026-10-19T01:30:00.000Z");
const MON_0230_UTC = new Date("2026-10-19T02:30:00.000Z");

describe("menuAvailabilitySchema", () => {
  it("accepts an empty schedule (always open)", () => {
    expect(menuAvailabilitySchema.safeParse([]).success).toBe(true);
  });

  it("rejects bad wall times, empty days, and duplicates", () => {
    expect(
      menuAvailabilitySchema.safeParse([{ days: [], start: "09:00", end: "17:00" }]).success
    ).toBe(false);
    expect(
      menuAvailabilitySchema.safeParse([{ days: [1], start: "9am", end: "17:00" }]).success
    ).toBe(false);
    expect(
      menuAvailabilitySchema.safeParse([{ days: [1, 1], start: "09:00", end: "17:00" }])
        .success
    ).toBe(false);
    expect(
      menuAvailabilitySchema.safeParse([{ days: [7], start: "09:00", end: "17:00" }]).success
    ).toBe(false);
  });

  it("rejects zero-length windows instead of treating them as always-open", () => {
    expect(
      menuAvailabilitySchema.safeParse([{ days: [1], start: "09:00", end: "09:00" }]).success
    ).toBe(false);
  });
});

describe("isMenuOpenAt", () => {
  it("is always open with no windows configured", () => {
    expect(isMenuOpenAt([], MON_NOON_UTC)).toBe(true);
    expect(isMenuOpenAt([], MON_0230_UTC)).toBe(true);
  });

  it("opens exactly at start and closes exactly at end", () => {
    const lunch = [{ days: [1], start: "09:00", end: "17:00" }];
    expect(isMenuOpenAt(lunch, MON_0859_UTC)).toBe(false);
    expect(isMenuOpenAt(lunch, MON_0900_UTC)).toBe(true);
    expect(isMenuOpenAt(lunch, MON_NOON_UTC)).toBe(true);
    expect(isMenuOpenAt(lunch, MON_1700_UTC)).toBe(false);
  });

  it("only serves on the listed weekdays", () => {
    const weekdayLunch = [{ days: [1, 2, 3, 4, 5], start: "11:00", end: "15:00" }];
    // Monday noon: open. Sunday noon is not a listed day: closed.
    expect(isMenuOpenAt(weekdayLunch, MON_NOON_UTC)).toBe(true);
    expect(isMenuOpenAt(weekdayLunch, new Date("2026-10-18T12:00:00.000Z"))).toBe(false);
  });

  it("is open when any window covers the time", () => {
    const split = [
      { days: [1], start: "08:00", end: "11:00" },
      { days: [1], start: "17:00", end: "22:00" },
    ];
    expect(isMenuOpenAt(split, MON_NOON_UTC)).toBe(false);
    expect(isMenuOpenAt(split, MON_0900_UTC)).toBe(true);
  });

  it("carries overnight windows past midnight into the next day", () => {
    // Sunday night service: listed on Sunday, open until 02:00 Monday.
    const late = [{ days: [0], start: "22:00", end: "02:00" }];
    expect(isMenuOpenAt(late, SUN_2330_UTC)).toBe(true);
    expect(isMenuOpenAt(late, MON_0130_UTC)).toBe(true);
    expect(isMenuOpenAt(late, MON_0230_UTC)).toBe(false);
    // Monday 12:00 is neither the listed day nor the spillover: closed.
    expect(isMenuOpenAt(late, MON_NOON_UTC)).toBe(false);
  });

  it("evaluates in the given time zone, not UTC", () => {
    // 12:00 UTC Monday is 08:00 in New York (EDT) — before a 09:00 open.
    const lunch = [{ days: [1], start: "09:00", end: "17:00" }];
    expect(isMenuOpenAt(lunch, MON_NOON_UTC)).toBe(true);
    expect(isMenuOpenAt(lunch, MON_NOON_UTC, "America/New_York")).toBe(false);
    // 16:00 UTC Monday is 12:00 in New York — inside the same window.
    expect(
      isMenuOpenAt(lunch, new Date("2026-10-19T16:00:00.000Z"), "America/New_York")
    ).toBe(true);
  });

  it("falls back to UTC for an unknown time zone instead of throwing", () => {
    const lunch = [{ days: [1], start: "09:00", end: "17:00" }];
    expect(isMenuOpenAt(lunch, MON_NOON_UTC, "Not/AZone")).toBe(true);
  });
});
