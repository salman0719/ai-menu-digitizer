import type { MenuAvailability } from "./schema";

/**
 * Pure open/closed evaluator for menu availability windows.
 *
 * `windows` is empty → always open (no restriction configured). Otherwise
 * the menu is open when *any* window covers `now` in the given IANA time
 * zone (default UTC — pass the restaurant's zone once one is stored).
 * Ranges are half-open [start, end): a menu opens exactly at `start` and
 * is already closed at `end`. Overnight windows (`end <= start`, e.g.
 * 22:00–02:00) cover the listed days from `start` to midnight plus the
 * following calendar day from 00:00 to `end`.
 *
 * Time-zone handling uses `Intl.DateTimeFormat`, so DST transitions follow
 * the zone's wall clock rather than a fixed offset.
 */

function minutesOf(wallTime: string): number {
  const [hours, minutes] = wallTime.split(":").map(Number);
  return hours * 60 + minutes;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function wallClock(now: Date, timeZone: string): { day: number; minutes: number } {
  let dayParts: Intl.DateTimeFormatPart[];
  let timeParts: Intl.DateTimeFormatPart[];
  try {
    dayParts = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).formatToParts(now);
    timeParts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(now);
  } catch {
    // Unknown zone (e.g. a bad stored value): evaluate in UTC rather than
    // throwing on a diner's request path.
    dayParts = DAY_FORMAT.formatToParts(now);
    timeParts = TIME_FORMAT.formatToParts(now);
  }
  const weekday = dayParts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(timeParts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(timeParts.find((part) => part.type === "minute")?.value ?? 0);
  return { day: WEEKDAY_TO_NUMBER[weekday] ?? 0, minutes: hour * 60 + minute };
}

/** True when the menu serves at `now` (empty schedule = always open). */
export function isMenuOpenAt(
  windows: MenuAvailability,
  now: Date,
  timeZone = "UTC"
): boolean {
  if (windows.length === 0) return true;
  const { day, minutes } = wallClock(now, timeZone);
  const previousDay = (day + 6) % 7;

  return windows.some((window) => {
    const start = minutesOf(window.start);
    const end = minutesOf(window.end);
    if (end > start) {
      // Same-day window: only the listed days, [start, end).
      return window.days.includes(day) && minutes >= start && minutes < end;
    }
    // Overnight window: listed days from `start` to midnight, plus the
    // following day from 00:00 to `end`.
    if (window.days.includes(day) && minutes >= start) return true;
    return window.days.includes(previousDay) && minutes < end;
  });
}
