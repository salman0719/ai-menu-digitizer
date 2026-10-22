import { z } from "zod";

/**
 * Per-menu opening windows for the multi-menu table landing
 * (`/r/[restaurant]/t/[table]`).
 *
 * An empty list means "always open" — the default for every menu until an
 * owner configures explicit windows. Each window names the weekdays it
 * covers (0 = Sunday … 6 = Saturday, matching `Date.getUTCDay`) plus a
 * half-open [start, end) range in 24-hour "HH:MM" wall time. When
 * `end <= start` the window crosses midnight (e.g. 22:00–02:00) and the
 * tail past midnight counts toward the *next* calendar day.
 *
 * Windows are interpreted in the restaurant's local wall time. The
 * evaluator (`./open-at`) takes an explicit IANA time zone and defaults to
 * UTC until a per-restaurant time-zone setting exists — the schema itself
 * stays zone-free on purpose.
 */

/** 24-hour wall time: 00:00 through 23:59. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const availabilityWindowSchema = z
  .object({
    /** Weekdays this window covers: 0 = Sunday … 6 = Saturday. */
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** Inclusive opening wall time, "HH:MM". */
    start: z.string().regex(TIME_PATTERN, "Use 24-hour HH:MM, e.g. 11:00."),
    /** Exclusive closing wall time, "HH:MM". `end <= start` means overnight. */
    end: z.string().regex(TIME_PATTERN, "Use 24-hour HH:MM, e.g. 22:00."),
  })
  .refine((window) => new Set(window.days).size === window.days.length, {
    message: "List each weekday only once per window.",
  })
  .refine((window) => window.start !== window.end, {
    message: "Start and end must differ — leave the menu unrestricted to keep it always open.",
  });

export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

/**
 * A menu's full opening schedule. Empty = always open (the default).
 * Capped at 28 windows (4 per weekday) so a misbehaving client cannot
 * store an unbounded list.
 */
export const menuAvailabilitySchema = z.array(availabilityWindowSchema).max(28);

export type MenuAvailability = z.infer<typeof menuAvailabilitySchema>;

/**
 * True when the runtime recognises `value` as an IANA time zone name.
 *
 * Opening windows are wall-clock times, so open/closed decisions also
 * need the restaurant's zone (stored on the restaurant row). The zone a
 * browser reports via `Intl` is accepted here, and the server re-checks
 * it rather than trusting the client.
 */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
