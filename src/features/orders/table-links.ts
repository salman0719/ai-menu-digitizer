/**
 * Pure helpers for table links encoded in QR codes.
 *
 * A table card encodes `{origin}/order?menu=<menuId>&table=<label>`. Nothing
 * secret is in the link: the menu id names a local record, and the page reads
 * it from this browser's IndexedDB. On a device without that record the page
 * says so instead of pretending the QR works.
 */

export const TABLE_ORDER_PATH = "/order";

/** Max label length keeps QR codes scannable and table cards readable. */
export const MAX_TABLE_LABEL_LENGTH = 24;

/** Max cards on one sheet; keeps the grid and QR payloads sane. */
export const MAX_TABLES = 40;

export interface TableLink {
  menuId: string;
  tableLabel: string;
}

export function normalizeTableLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_TABLE_LABEL_LENGTH) return null;
  return trimmed;
}

/**
 * A table label as a guest should read it. Labels carry whatever the staff
 * typed ("Table 3", "3", "Patio 2"), so never paste "Table" in front of
 * one that already names the table: a bare number gets the prefix, a
 * descriptive label is shown verbatim.
 */
export function formatTableLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "Table";
  return /^\d+$/.test(trimmed) ? `Table ${trimmed}` : trimmed;
}

/** A URL as printed on a card: scheme stripped, spaces decoded for typing. */
export function displayTableUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\+/g, " ")
    .replace(/%20/gi, " ");
}

/** Default labels for a dining room: "1".."12" or "Table 1".."Table 12". */
export function defaultTableLabels(count: number, prefix = ""): string[] {
  const safe = Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 1), 60) : 1;
  return Array.from({ length: safe }, (_, index) =>
    prefix ? `${prefix} ${index + 1}` : String(index + 1)
  );
}

/**
 * Clean an explicitly typed list ("Patio 1", "Bar", …): trim, drop blanks
 * and overlong entries, de-duplicate while keeping order, cap length.
 */
export function sanitizeTableLabels(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const value of values) {
    const label = normalizeTableLabel(value);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    clean.push(label);
    if (clean.length >= MAX_TABLES) break;
  }
  return clean;
}

export function tableOrderPath(menuId: string, tableLabel: string): string {
  const params = new URLSearchParams({ menu: menuId, table: tableLabel });
  return `${TABLE_ORDER_PATH}?${params.toString()}`;
}

export function tableOrderUrl(origin: string, menuId: string, tableLabel: string): string {
  // Trim trailing slashes on the origin only; the path is fixed.
  const base = origin.replace(/\/+$/, "");
  return `${base}${tableOrderPath(menuId, tableLabel)}`;
}

/**
 * Multi-menu table landing (Steps 1–2): one QR per table resolves to the
 * restaurant, and the diner sees every currently-open menu there. The table
 * label is path-encoded so names like "Patio 2" survive the QR payload.
 */
export function restaurantTablePath(restaurantSlug: string, tableLabel: string): string {
  return `/r/${restaurantSlug}/t/${encodeURIComponent(tableLabel)}`;
}

export function restaurantTableUrl(origin: string, restaurantSlug: string, tableLabel: string): string {
  return `${origin.replace(/\/+$/, "")}${restaurantTablePath(restaurantSlug, tableLabel)}`;
}

/**
 * Server-backed table link (Step 10): the published menu's own address, so a
 * QR code works on any phone instead of only the browser holding the menu.
 * The address is scoped to the café (`/r/<restaurant>/m/<menu>`), the same
 * shape the publish panel shares.
 */
export function publicTableOrderPath(
  restaurantSlug: string,
  menuSlug: string,
  tableLabel: string
): string {
  const params = new URLSearchParams({ table: tableLabel });
  return `/r/${encodeURIComponent(restaurantSlug)}/m/${encodeURIComponent(menuSlug)}/order?${params.toString()}`;
}

export function publicTableOrderUrl(
  origin: string,
  restaurantSlug: string,
  menuSlug: string,
  tableLabel: string
): string {
  return `${origin.replace(/\/+$/, "")}${publicTableOrderPath(restaurantSlug, menuSlug, tableLabel)}`;
}

/** Read `menu`/`table` from a query object or URLSearchParams. */
export function parseTableLink(
  params: URLSearchParams | Record<string, string | string[] | undefined>
): TableLink | null {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };
  const menuId = get("menu")?.trim();
  const tableLabel = normalizeTableLabel(get("table"));
  if (!menuId || !tableLabel) return null;
  return { menuId, tableLabel };
}
