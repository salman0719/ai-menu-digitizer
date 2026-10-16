/**
 * Pure display helpers for the customer-facing menu preview.
 *
 * The preview shows the menu as a diner would see it — no review badges, no
 * editor chrome, and never an invented value: a missing price renders as an
 * em dash (PLAN.md: never invent prices; show nulls honestly).
 */

/**
 * Format an item price, or an em dash when the price is unknown.
 * Falls back to the item currency, then the menu currency, then nothing.
 */
export function formatPreviewPrice(
  price: number | null,
  currency: string | null,
  fallbackCurrency: string | null
): string {
  if (price === null) return "—";
  const effective = currency ?? fallbackCurrency ?? "";
  return `${effective ? `${effective} ` : ""}${price.toFixed(2)}`;
}

/**
 * Format an option-choice price delta as "+1.50" / "−0.50".
 * Returns an empty string when the delta is unknown (nothing is invented).
 */
export function formatPriceDelta(delta: number | null): string {
  if (delta === null) return "";
  const sign = delta < 0 ? "−" : "+";
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}
