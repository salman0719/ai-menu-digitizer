/**
 * Visual themes for the customer-facing menu preview.
 *
 * Pure data + tiny helpers so the preview component stays presentational and
 * the themes can be tested without rendering. Each theme is a set of Tailwind
 * class tokens applied by `menu-preview.tsx`; no colours or fonts are invented
 * at render time.
 */

export type PreviewThemeId = "classic" | "bistro" | "modern" | "chalkboard";

export interface PreviewTheme {
  id: PreviewThemeId;
  /** Human label shown in the theme picker. */
  name: string;
  /** Page surface: background, text colour, ring/border. */
  page: string;
  /** Serif/sans/mono family for headings and body. */
  font: string;
  /** Title alignment class. */
  headerAlign: "text-center" | "text-left";
  title: string;
  /** Small label above the title, e.g. "Menu". */
  eyebrow: string;
  sectionHeading: string;
  itemName: string;
  description: string;
  price: string;
  /** Dotted rule between item name and price. */
  leader: string;
  variantName: string;
  variantPrice: string;
  badge: string;
  /** Divider between sections. */
  sectionRule: string;
}

export const PREVIEW_THEMES: Record<PreviewThemeId, PreviewTheme> = {
  classic: {
    id: "classic",
    name: "Classic",
    page: "bg-[#fdfaf4] text-stone-900 ring-1 ring-stone-200",
    font: "font-serif",
    headerAlign: "text-center",
    title: "text-3xl font-bold tracking-tight sm:text-4xl",
    eyebrow: "text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-500",
    sectionHeading:
      "text-xs font-semibold uppercase tracking-[0.2em] text-stone-500 text-center",
    itemName: "font-medium text-stone-900",
    description: "text-stone-600",
    price: "tabular-nums text-stone-900",
    leader: "border-stone-300",
    variantName: "text-stone-600",
    variantPrice: "font-medium text-stone-800",
    badge: "bg-stone-100 text-stone-700",
    sectionRule: "border-stone-200",
  },
  bistro: {
    id: "bistro",
    name: "Bistro",
    page: "bg-white text-stone-900 ring-1 ring-amber-900/15",
    font: "font-serif",
    headerAlign: "text-center",
    title: "text-3xl font-semibold tracking-tight italic sm:text-4xl",
    eyebrow: "text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-800",
    sectionHeading:
      "border-b border-amber-900/25 pb-1 text-sm font-bold uppercase tracking-[0.18em] text-amber-900",
    itemName: "font-semibold text-stone-900",
    description: "text-stone-600 italic",
    price: "tabular-nums text-amber-900",
    leader: "border-amber-900/25",
    variantName: "text-stone-600",
    variantPrice: "font-semibold text-amber-900",
    badge: "bg-amber-100 text-amber-900",
    sectionRule: "border-amber-900/15",
  },
  modern: {
    id: "modern",
    name: "Modern",
    page: "bg-white text-stone-900 ring-1 ring-stone-200",
    font: "font-sans",
    headerAlign: "text-left",
    title: "text-3xl font-bold tracking-tighter sm:text-4xl",
    eyebrow: "text-[11px] font-semibold uppercase tracking-widest text-stone-400",
    sectionHeading: "text-xs font-semibold uppercase tracking-widest text-stone-400",
    itemName: "font-medium text-stone-900",
    description: "text-stone-500",
    price: "tabular-nums font-semibold text-stone-900",
    leader: "border-stone-200",
    variantName: "text-stone-500",
    variantPrice: "font-semibold text-stone-800",
    badge: "bg-stone-100 text-stone-600",
    sectionRule: "border-stone-200",
  },
  chalkboard: {
    id: "chalkboard",
    name: "Chalkboard",
    page: "bg-stone-900 text-stone-100 ring-1 ring-stone-700",
    font: "font-serif",
    headerAlign: "text-center",
    title: "text-3xl font-bold tracking-tight italic sm:text-4xl",
    eyebrow: "text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-200/80",
    sectionHeading:
      "text-xs font-semibold uppercase tracking-[0.25em] text-amber-200/80 text-center",
    itemName: "font-medium text-stone-50",
    description: "text-stone-300/80",
    price: "tabular-nums text-stone-100",
    leader: "border-stone-600",
    variantName: "text-stone-300",
    variantPrice: "font-semibold text-amber-100",
    badge: "bg-stone-800 text-stone-200",
    sectionRule: "border-stone-700",
  },
};

export const PREVIEW_THEME_IDS = Object.keys(PREVIEW_THEMES) as PreviewThemeId[];

export const DEFAULT_PREVIEW_THEME_ID: PreviewThemeId = "classic";

export function isPreviewThemeId(value: unknown): value is PreviewThemeId {
  return typeof value === "string" && value in PREVIEW_THEMES;
}

export function previewTheme(id: PreviewThemeId | null | undefined): PreviewTheme {
  return isPreviewThemeId(id) ? PREVIEW_THEMES[id] : PREVIEW_THEMES[DEFAULT_PREVIEW_THEME_ID];
}
