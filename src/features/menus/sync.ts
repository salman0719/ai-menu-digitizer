/**
 * Typed browser client for the server menu API (`/api/menus`). Client-safe:
 * this module must never import the server repo or Drizzle — it ships in the
 * client bundle and talks HTTP only.
 *
 * Every response is validated with Zod at the boundary (AGENTS.md: Zod for
 * server boundaries), so a malformed or unexpectedly shaped server payload
 * surfaces as `SyncError("unavailable")` instead of corrupting the UI.
 *
 * Error mapping (server → client code):
 * - 401                       → unauthorized (session expired / signed out)
 * - 409 stale_menu            → conflict (+ `currentUpdatedAt` for re-basing)
 * - 409 menu_exists           → exists (the id already lives on the server)
 * - 403                       → forbidden (member, but not the owner)
 * - 404                       → not_found
 * - 400                       → invalid
 * - 503 / network failure     → unavailable (server DB off; keep working locally)
 */

import { z } from "zod";

import { menuDocumentSchema, type MenuDocument } from "@/features/menu/schema";

/** Summary shape returned by list endpoints (mirrors the server repo). */
export const serverMenuSummarySchema = z.object({
  id: z.string().min(1),
  restaurantId: z.string().min(1),
  restaurantName: z.string(),
  title: z.string(),
  currency: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/** A full server menu: summary fields plus the canonical document. */
export const serverMenuSchema = serverMenuSummarySchema.extend({
  doc: menuDocumentSchema,
});

export type ServerMenuSummary = z.infer<typeof serverMenuSummarySchema>;
export type ServerMenu = z.infer<typeof serverMenuSchema>;

/** Single-menu endpoints wrap the menu in `{ menu }`. */
const menuEnvelope = z.object({ menu: serverMenuSchema });

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    currentUpdatedAt: z.string().nullable().optional(),
  }),
});

export type SyncErrorCode =
  | "unauthorized"
  | "conflict"
  | "exists"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "unavailable";

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  /** For `conflict`: the server's current updatedAt, for an explicit re-base. */
  readonly currentUpdatedAt: string | null;

  constructor(code: SyncErrorCode, message: string, currentUpdatedAt: string | null = null) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

/** Server error codes → client codes. Unknown codes degrade by status. */
function mapErrorCode(code: string, status: number): SyncErrorCode {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "stale_menu":
      return "conflict";
    case "menu_exists":
      return "exists";
    case "forbidden":
      return "forbidden";
    case "not_found":
      return "not_found";
    case "invalid_body":
      return "invalid";
    case "server_db_unavailable":
      return "unavailable";
    default:
      break;
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400) return "invalid";
  return "unavailable";
}

/**
 * Perform a request and decode its JSON payload, mapping HTTP failures and
 * malformed payloads onto `SyncError`.
 */
async function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  decode: (payload: unknown) => T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    // Offline / server unreachable: signed-in editing degrades loudly but
    // the local copy is untouched (IndexedDB stays the offline cache).
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }

  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const envelope = errorEnvelopeSchema.safeParse(payload);
    if (envelope.success) {
      const { code, message, currentUpdatedAt } = envelope.data.error;
      throw new SyncError(mapErrorCode(code, response.status), message, currentUpdatedAt ?? null);
    }
    throw new SyncError(
      mapErrorCode("", response.status),
      `The server responded ${response.status} in an unexpected shape.`
    );
  }

  try {
    return decode(payload);
  } catch {
    throw new SyncError(
      "unavailable",
      "The server sent data this app could not understand. Try again in a moment."
    );
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** All menus across the caller's restaurants, most recent revision first. */
export async function fetchServerMenus(): Promise<ServerMenuSummary[]> {
  return requestJson("/api/menus", undefined, (payload) => {
    const shape = z.object({ menus: z.array(serverMenuSummarySchema) }).parse(payload);
    return shape.menus;
  });
}

/** One server menu (any member of its restaurant may read). */
export async function fetchServerMenu(menuId: string): Promise<ServerMenu> {
  return requestJson(`/api/menus/${encodeURIComponent(menuId)}`, undefined, (payload) =>
    menuEnvelope.parse(payload).menu
  );
}

/**
 * Create a server menu. The document's own `id` becomes the row id, so
 * "Move my menus to my account" preserves local ids (import by id).
 * Throws `SyncError("exists")` when the id is already on the server.
 */
export async function createServerMenu(
  restaurantId: string,
  doc: MenuDocument
): Promise<ServerMenu> {
  return requestJson("/api/menus", jsonInit("POST", { restaurantId, doc }), (payload) =>
    menuEnvelope.parse(payload).menu
  );
}

/**
 * Replace a server menu's document, but only if it has not changed since
 * `expectedUpdatedAt` was read. A stale token throws `SyncError("conflict")`
 * carrying the server's current `updatedAt` — callers must surface the
 * conflict and let the user reload explicitly, never silently overwrite.
 */
export async function updateServerMenu(
  menuId: string,
  doc: MenuDocument,
  expectedUpdatedAt: string
): Promise<ServerMenu> {
  return requestJson(
    `/api/menus/${encodeURIComponent(menuId)}`,
    jsonInit("PUT", { doc, expectedUpdatedAt }),
    (payload) => menuEnvelope.parse(payload).menu
  );
}

/** Delete a server menu (owner-only). */
export async function deleteServerMenu(menuId: string): Promise<void> {
  await requestJson(`/api/menus/${encodeURIComponent(menuId)}`, { method: "DELETE" }, () => null);
}
