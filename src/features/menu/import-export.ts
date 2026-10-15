/**
 * JSON/CSV export and JSON import. All serialization is pure; only
 * `downloadTextFile` touches the DOM (called from UI event handlers).
 */

import { generateId } from "./menu-utils";
import { menuDocumentSchema, type MenuDocument } from "./schema";

export function serializeMenu(doc: MenuDocument): string {
  const parsed = menuDocumentSchema.safeParse(doc);
  if (!parsed.success) throw new Error("Cannot export: the menu data is invalid.");
  return `${JSON.stringify(parsed.data, null, 2)}\n`;
}

export function menuFilename(title: string | null | undefined, ext: "json" | "csv"): string {
  const slug = (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "menu"}.${ext}`;
}

const CSV_COLUMNS = [
  "category",
  "name",
  "description",
  "price",
  "currency",
  "available",
  "dietary_labels",
] as const;

function csvField(value: string): string {
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvAvailability(available: boolean | null): string {
  if (available === null) return "";
  return available ? "true" : "false";
}

export function menuToCsv(doc: MenuDocument): string {
  const parsed = menuDocumentSchema.safeParse(doc);
  if (!parsed.success) throw new Error("Cannot export: the menu data is invalid.");
  const menu = parsed.data;
  const lines = [CSV_COLUMNS.join(",")];
  for (const category of menu.categories) {
    for (const item of category.items) {
      lines.push(
        [
          category.name,
          item.name,
          item.description ?? "",
          item.price === null ? "" : String(item.price),
          item.currency ?? menu.currency ?? "",
          csvAvailability(item.available),
          item.dietaryLabels.join("; "),
        ]
          .map(csvField)
          .join(",")
      );
    }
  }
  // CRLF line endings for spreadsheet compatibility.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Parse a previously exported menu file. Returns a document with a FRESH id
 * (re-importing the same file creates a copy instead of overwriting) and a
 * current timestamp; categories, items, and their ids are preserved.
 */
export function parseImportedMenu(jsonText: string): MenuDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("That file is not valid JSON. Export a menu from this app and try again.");
  }
  const result = menuDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "menu";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`That file is not a valid menu export (${details}).`);
  }
  return {
    ...result.data,
    id: generateId(),
    updatedAt: new Date().toISOString(),
  };
}

export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
