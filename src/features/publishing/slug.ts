import { MENU_SLUG_PATTERN, SLUG_MAX_LENGTH } from "./schema";

/**
 * Slug generation for public menu links (Step 9).
 *
 * `slugifyMenuTitle` is deterministic and lossy on purpose: it turns a café's
 * name into a readable, link-safe address. It never invents words, and it
 * falls back to "menu" when a title has no usable characters (e.g. "🍜").
 *
 * Collisions are resolved by suffixing "-2", "-3", … — the owner can always
 * change the address afterwards, and the first free candidate wins. Uniqueness
 * is per restaurant: two cafés publishing the same title get the same base
 * slug, each under its own `/r/<slug>` address.
 */

/** Characters that NFKD leaves behind as combining marks. */
const COMBINING_MARKS = /\p{Diacritic}/gu;

/** Strip accents, lowercase, and hyphenate everything that isn't [a-z0-9]. */
export function slugifyMenuTitle(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return truncateSlug(normalized) || "menu";
}

/** Cut at SLUG_MAX_LENGTH without leaving a trailing hyphen. */
function truncateSlug(value: string): string {
  if (value.length <= SLUG_MAX_LENGTH) return value;
  return value.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
}

/**
 * Ordered candidates for a base slug: `base`, `base-2`, `base-3`, … Each one
 * is a valid slug, and truncation happens on the base so the suffix always
 * fits.
 */
export function slugCandidates(base: string, count = 25): string[] {
  const clean = truncateSlug(base) || "menu";
  const candidates = [clean];
  for (let n = 2; n <= count; n += 1) {
    const suffix = `-${n}`;
    candidates.push(`${truncateSlug(clean.slice(0, SLUG_MAX_LENGTH - suffix.length))}${suffix}`);
  }
  return candidates;
}

/** True when a value is already a canonical slug (used after normalization). */
export function isSlug(value: string): boolean {
  return MENU_SLUG_PATTERN.test(value) && value.length <= SLUG_MAX_LENGTH;
}
