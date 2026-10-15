/**
 * Menu persistence over IndexedDB. Browser-only — never import from server code.
 *
 * Every write validates with the canonical schema first, so corrupt data is
 * refused at the door. Reads validate too: outdated/malformed records surface
 * as explicit errors instead of crashing the UI.
 */

import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  IMAGES_STORE,
  isQuotaError,
  MENUS_STORE,
  tx,
} from "./indexeddb";
import { createMenuDocument } from "./menu-utils";
import { menuDocumentSchema, type MenuDocument } from "./schema";

export type StorageErrorCode = "unavailable" | "quota" | "corrupt" | "not_found";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export interface MenuSummary {
  id: string;
  title: string;
  currency: string | null;
  updatedAt: string;
  categoryCount: number;
  itemCount: number;
  /** True when the stored record failed validation (shown, not hidden). */
  corrupt: boolean;
}

export interface StoredImage {
  blob: Blob;
  mimeType: string;
  updatedAt: string;
}

function storageError(operation: string, error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  if (isQuotaError(error)) {
    return new StorageError(
      "quota",
      "Browser storage is full. Export important menus as JSON, then free space and try again."
    );
  }
  const detail = error instanceof Error ? ` ${error.message}` : "";
  return new StorageError(
    "unavailable",
    `Could not ${operation} — your changes are kept in memory for now.${detail}`
  );
}

function toSummary(id: string, record: unknown): MenuSummary {
  const parsed = menuDocumentSchema.safeParse(record);
  if (!parsed.success) {
    return {
      id,
      title: "(unreadable record)",
      currency: null,
      updatedAt: "",
      categoryCount: 0,
      itemCount: 0,
      corrupt: true,
    };
  }
  const doc = parsed.data;
  return {
    id: doc.id,
    title: doc.title,
    currency: doc.currency,
    updatedAt: doc.updatedAt,
    categoryCount: doc.categories.length,
    itemCount: doc.categories.reduce((sum, c) => sum + c.items.length, 0),
    corrupt: false,
  };
}

export async function listMenus(): Promise<MenuSummary[]> {
  try {
    const records = await tx(MENUS_STORE, "readonly", ([store]) => idbGetAll<unknown>(store));
    return records
      .map((record) => {
        const id =
          record !== null && typeof record === "object" && "id" in record
            ? String((record as { id: unknown }).id)
            : "unknown";
        return toSummary(id, record);
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch (error) {
    throw storageError("list saved menus", error);
  }
}

export async function getMenu(id: string): Promise<MenuDocument> {
  try {
    const record = await tx(MENUS_STORE, "readonly", ([store]) => idbGet<unknown>(store, id));
    if (record === undefined) {
      throw new StorageError("not_found", "That menu no longer exists in this browser.");
    }
    const parsed = menuDocumentSchema.safeParse(record);
    if (!parsed.success) {
      throw new StorageError(
        "corrupt",
        "This saved menu is damaged or from an incompatible version and cannot be opened. Delete it or restore from a JSON backup."
      );
    }
    return parsed.data;
  } catch (error) {
    throw storageError("open the menu", error);
  }
}

export async function saveMenu(doc: MenuDocument): Promise<MenuDocument> {
  const parsed = menuDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new StorageError("corrupt", "Refusing to save: the menu data is invalid.");
  }
  const stamped: MenuDocument = { ...parsed.data, updatedAt: new Date().toISOString() };
  try {
    await tx(MENUS_STORE, "readwrite", ([store]) => idbPut(store, stamped));
    return stamped;
  } catch (error) {
    throw storageError("save the menu", error);
  }
}

export async function createMenu(title?: string): Promise<MenuDocument> {
  return saveMenu(createMenuDocument(title?.trim() ? { title: title.trim() } : undefined));
}

export async function renameMenu(id: string, title: string): Promise<MenuDocument> {
  const trimmed = title.trim();
  if (!trimmed) throw new StorageError("corrupt", "Menu title must not be empty.");
  const doc = await getMenu(id);
  return saveMenu({ ...doc, title: trimmed });
}

export async function deleteMenu(id: string): Promise<void> {
  try {
    await tx([MENUS_STORE, IMAGES_STORE], "readwrite", ([menus, images]) =>
      Promise.all([idbDelete(menus, id), idbDelete(images, id)]).then(() => undefined)
    );
  } catch (error) {
    throw storageError("delete the menu", error);
  }
}

export async function saveImage(menuId: string, blob: Blob): Promise<void> {
  const record = {
    menuId,
    blob,
    mimeType: blob.type || "application/octet-stream",
    updatedAt: new Date().toISOString(),
  };
  try {
    await tx(IMAGES_STORE, "readwrite", ([store]) => idbPut(store, record));
  } catch (error) {
    throw storageError("save the menu image", error);
  }
}

export async function getImage(menuId: string): Promise<StoredImage | null> {
  try {
    const record = await tx(IMAGES_STORE, "readonly", ([store]) =>
      idbGet<{ blob: Blob; mimeType: string; updatedAt: string }>(store, menuId)
    );
    if (!record || !(record.blob instanceof Blob)) return null;
    return { blob: record.blob, mimeType: record.mimeType, updatedAt: record.updatedAt };
  } catch (error) {
    throw storageError("read the menu image", error);
  }
}

export async function deleteImage(menuId: string): Promise<void> {
  try {
    await tx(IMAGES_STORE, "readwrite", ([store]) => idbDelete(store, menuId));
  } catch (error) {
    throw storageError("delete the menu image", error);
  }
}
