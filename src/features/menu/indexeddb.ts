/**
 * Native IndexedDB access for menus and image blobs. Browser-only — never
 * import from server code (there is no `indexedDB` in Node/edge runtimes).
 *
 * Database `ai-menu-digitizer`, version 1:
 * - `menus` (keyPath `id`): validated `MenuDocument` records.
 * - `images` (keyPath `menuId`): `{ menuId, blob, mimeType, updatedAt }`.
 *
 * Upgrades create missing stores per version step so future versions can
 * extend the switch without breaking existing data.
 */

export const DB_NAME = "ai-menu-digitizer";
export const DB_VERSION = 1;

export const MENUS_STORE = "menus";
export const IMAGES_STORE = "images";

export class IndexedDbUnavailableError extends Error {
  constructor(message = "This browser does not support IndexedDB, or it is disabled.") {
    super(message);
    this.name = "IndexedDbUnavailableError";
  }
}

export class IndexedDbError extends Error {
  constructor(operation: string, cause?: unknown) {
    super(
      `IndexedDB ${operation} failed${cause instanceof Error ? `: ${cause.message}` : "."} Your edits are kept in memory but may be lost on refresh.`
    );
    this.name = "IndexedDbError";
    this.cause = cause;
  }
}

function factory(): IDBFactory {
  const idb = globalThis.indexedDB;
  if (!idb) throw new IndexedDbUnavailableError();
  return idb;
}

function requestToPromise<T>(request: IDBRequest<T>, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new IndexedDbError(operation, request.error ?? undefined));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory().open(DB_NAME, DB_VERSION);
      } catch (error) {
        dbPromise = null;
        reject(
          error instanceof IndexedDbUnavailableError ? error : new IndexedDbUnavailableError()
        );
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MENUS_STORE)) {
          db.createObjectStore(MENUS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE, { keyPath: "menuId" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(new IndexedDbError("open", request.error ?? undefined));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(
          new IndexedDbError("open blocked — close other tabs open on this site and try again")
        );
      };
    });
  }
  return dbPromise;
}

/** Close and forget the cached connection (used in tests). */
export function closeDatabase(): void {
  // Intentionally fire-and-forget: closing never rejects.
  void dbPromise?.then((db) => db.close()).catch(() => undefined);
  dbPromise = null;
}

/**
 * Run `run` inside a transaction over `storeNames`. Resolves after commit;
 * rejects on request, transaction, or callback errors.
 */
export async function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (stores: IDBObjectStore[]) => Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const transaction = db.transaction(names, mode);
  const stores = names.map((name) => transaction.objectStore(name));
  const committed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(new IndexedDbError("transaction", transaction.error ?? undefined));
    transaction.onabort = () =>
      reject(new IndexedDbError("transaction aborted", transaction.error ?? undefined));
  });
  let result: T;
  try {
    result = await run(stores);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Already finished; the original error below is what matters.
    }
    throw error;
  }
  await committed;
  return result;
}

export function idbGet<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return requestToPromise<T | undefined>(store.get(key), "read");
}

export function idbPut(store: IDBObjectStore, value: unknown): Promise<void> {
  return requestToPromise(store.put(value), "write").then(() => undefined);
}

export function idbDelete(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return requestToPromise(store.delete(key), "delete").then(() => undefined);
}

export function idbGetAll<T>(store: IDBObjectStore): Promise<T[]> {
  return requestToPromise<T[]>(store.getAll(), "read");
}

export function isQuotaError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "QuotaExceededError") ||
    (isRecord(error) && error.name === "QuotaExceededError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
