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

/** Default labels for a dining room: "1".."12" or "Table 1".."Table 12". */
export function defaultTableLabels(count: number, prefix = ""): string[] {
  const safe = Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 1), 60) : 1;
  return Array.from({ length: safe }, (_, index) =>
    prefix ? `${prefix} ${index + 1}` : String(index + 1)
  );
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
