/**
 * Site-wide constants that appear in user-facing copy.
 *
 * The product name is temporary (AGENTS.md). Keeping it here means a rename
 * is one edit, not a hunt through pages.
 */

export const SITE_NAME = "Tablepass";

/** Shown as "last updated" on both legal pages. */
export const LEGAL_UPDATED = "18 October 2026";

/**
 * Where privacy and account questions go. Deliberately not defaulted to an
 * address we do not own: an unset value renders an explicit "not configured"
 * line instead of silently pointing at a mailbox nobody reads.
 */
export function contactEmail(): string | null {
  const value = process.env.CONTACT_EMAIL?.trim();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}
