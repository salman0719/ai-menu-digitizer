import type { MenuAvailability } from "./schema";

/**
 * Diner-facing text for a menu's opening windows.
 *
 * Used by the table landing for menus that are published but not being
 * served right now: the tab stays visible but disabled, and these lines
 * tell the diner when it opens. Wall times are rendered exactly as the
 * windows store them (12-hour with am/pm) and weekdays are compressed
 * into ranges, so "Monday through Friday, half eleven to half two" reads
 * as `Mon–Fri 11:30 am – 2:30 pm`. Zone-free by design — the evaluator
 * decides open/closed, this only formats.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "11:30" → "11:30 am"; "00:15" → "12:15 am"; "12:00" → "12:00 pm". */
export function formatWallClock(time: string): string {
  const [rawHours, rawMinutes] = time.split(":").map(Number);
  const hours = Number.isFinite(rawHours) ? rawHours : 0;
  const minutes = Number.isFinite(rawMinutes) ? rawMinutes : 0;
  const suffix = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** Sorted weekdays compressed to "Mon–Fri", "Sat, Sun", or "Every day". */
function formatDays(days: number[]): string {
  const unique = [...new Set(days)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
  if (unique.length === 0) return "";
  if (unique.length === 7) return "Every day";

  const ranges: Array<[number, number]> = [];
  for (const day of unique) {
    const last = ranges[ranges.length - 1];
    if (last && day === last[1] + 1) last[1] = day;
    else ranges.push([day, day]);
  }
  return ranges
    .map(([first, last]) => (first === last ? DAY_NAMES[first] : `${DAY_NAMES[first]}–${DAY_NAMES[last]}`))
    .join(", ");
}

/**
 * One readable line per window (`"Mon–Fri 11:30 am – 2:30 pm"`), at most
 * `maxLines` of them — a long schedule ends with a "+N more" line so a
 * tooltip-sized note never turns into a timetable.
 */
export function formatAvailability(windows: MenuAvailability, maxLines = 4): string[] {
  const lines = windows.map(
    (window) => `${formatDays(window.days)} ${formatWallClock(window.start)} – ${formatWallClock(window.end)}`
  );
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `+${lines.length - maxLines} more`];
}
