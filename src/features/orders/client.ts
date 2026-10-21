/**
 * Typed browser client for the orders API. Client-safe: HTTP only, no Drizzle
 * and no server repository imports.
 *
 * Every response is re-validated with the canonical order schema, so a
 * malformed payload fails as `SyncError("unavailable")` instead of putting a
 * half-order on the board. Error mapping follows the app's shared taxonomy:
 * 401 unauthorized, 403 forbidden, 404 not_found, 409 conflict (a stale
 * status write — reload and decide again), 400 invalid, 429 rate_limited,
 * anything else unavailable.
 */

import { z } from "zod";

import { SyncError, type SyncErrorCode } from "@/features/menus/sync";

import { orderSchema, type Order, type OrderStatus } from "./schema";

const orderEnvelope = z.object({ order: orderSchema });
const boardEnvelope = z.object({
  orders: z.array(orderSchema),
  serverTime: z.string().min(1),
});

const errorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface PlaceOrderRequest {
  /** Single-menu path: the menu's public slug. Omit on the table path. */
  slug?: string;
  /** Table path: the restaurant's public slug; every line names its menu. */
  restaurantSlug?: string;
  tableLabel: string;
  note: string | null;
  lines: {
    menuSlug?: string;
    menuItemId: string;
    variantName: string | null;
    quantity: number;
  }[];
  /** Honeypot — always empty for a human; the server refuses filled values. */
  website: string;
}

function mapErrorCode(code: string, status: number): SyncErrorCode {
  switch (code) {
    case "unauthorized":
      return "unauthorized";
    case "forbidden":
      return "forbidden";
    case "not_found":
    case "menu_not_live":
      return "not_found";
    case "order_stale":
      return "conflict";
    case "rate_limited":
      return "rate_limited";
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
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid";
  return "unavailable";
}

async function requestJson<T>(
  path: string,
  init: RequestInit | undefined,
  decode: (payload: unknown) => T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new SyncError("unavailable", "Could not reach the server. Check your connection.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const envelope = errorEnvelope.safeParse(payload);
    if (envelope.success) {
      throw new SyncError(
        mapErrorCode(envelope.data.error.code, response.status),
        envelope.data.error.message
      );
    }
    throw new SyncError("unavailable", `The server responded ${response.status}.`);
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

/** Place an order from a public table link (no account required). */
export async function placeOrder(input: PlaceOrderRequest): Promise<Order> {
  return requestJson("/api/orders", jsonInit("POST", input), (payload) =>
    orderEnvelope.parse(payload).order
  );
}

/**
 * Board query. Without `since` it returns the newest orders; with it, every
 * order changed after that server timestamp (status edits included).
 */
export async function fetchStaffOrders(options: {
  since?: string | null;
  restaurantId?: string | null;
  limit?: number;
} = {}): Promise<{ orders: Order[]; serverTime: string }> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.restaurantId) params.set("restaurantId", options.restaurantId);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return requestJson(`/api/orders${query ? `?${query}` : ""}`, undefined, (payload) =>
    boardEnvelope.parse(payload)
  );
}

/**
 * Move an order's status. Pass the `updatedAt` last seen so a concurrent
 * change from another device results in `SyncError("conflict")` rather than
 * an overwrite.
 */
export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  expectedUpdatedAt?: string | null
): Promise<Order> {
  return requestJson(
    `/api/orders/${encodeURIComponent(orderId)}`,
    jsonInit("PATCH", {
      status,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    }),
    (payload) => orderEnvelope.parse(payload).order
  );
}
