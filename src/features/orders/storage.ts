/**
 * Order persistence over IndexedDB. Browser-only — never import from server
 * code. Records are validated on write and on read, like menus: a damaged
 * order surfaces as an explicit error rather than a crash.
 */

import {
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  isQuotaError,
  ORDERS_STORE,
  tx,
} from "../menu/indexeddb";
import { generateId, nowIso } from "../menu/menu-utils";

import {
  isOrderStatus,
  orderSchema,
  type Order,
  type OrderLine,
  type OrderStatus,
} from "./schema";

export type OrderStorageErrorCode = "unavailable" | "quota" | "corrupt" | "not_found";

export class OrderStorageError extends Error {
  readonly code: OrderStorageErrorCode;

  constructor(code: OrderStorageErrorCode, message: string) {
    super(message);
    this.name = "OrderStorageError";
    this.code = code;
  }
}

function storageError(operation: string, error: unknown): OrderStorageError {
  if (error instanceof OrderStorageError) return error;
  if (isQuotaError(error)) {
    return new OrderStorageError(
      "quota",
      "Browser storage is full, so the order could not be saved. Free space and try again."
    );
  }
  const detail = error instanceof Error ? ` ${error.message}` : "";
  return new OrderStorageError("unavailable", `Could not ${operation}.${detail}`);
}

export interface NewOrderInput {
  menuId: string;
  menuTitle: string;
  tableLabel: string;
  currency: string | null;
  note: string | null;
  lines: OrderLine[];
}

/** Create and persist a new order in `new` status. */
export async function createOrder(input: NewOrderInput): Promise<Order> {
  const timestamp = nowIso();
  const candidate = {
    id: generateId(),
    menuId: input.menuId,
    menuTitle: input.menuTitle,
    tableLabel: input.tableLabel.trim(),
    currency: input.currency ?? null,
    note: input.note?.trim() ? input.note.trim() : null,
    lines: input.lines,
    status: "new" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const parsed = orderSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new OrderStorageError("corrupt", "Refusing to save an invalid order.");
  }
  try {
    await tx(ORDERS_STORE, "readwrite", ([store]) => idbPut(store, parsed.data));
    return parsed.data;
  } catch (error) {
    throw storageError("save the order", error);
  }
}

/** Newest first. Unreadable records are reported, never hidden. */
export async function listOrders(): Promise<{ orders: Order[]; corruptCount: number }> {
  try {
    const records = await tx(ORDERS_STORE, "readonly", ([store]) => idbGetAll<unknown>(store));
    const orders: Order[] = [];
    let corruptCount = 0;
    for (const record of records) {
      const parsed = orderSchema.safeParse(record);
      if (parsed.success) orders.push(parsed.data);
      else corruptCount += 1;
    }
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { orders, corruptCount };
  } catch (error) {
    throw storageError("read saved orders", error);
  }
}

export async function getOrder(id: string): Promise<Order> {
  try {
    const record = await tx(ORDERS_STORE, "readonly", ([store]) => idbGet<unknown>(store, id));
    if (record === undefined) {
      throw new OrderStorageError("not_found", "That order no longer exists.");
    }
    const parsed = orderSchema.safeParse(record);
    if (!parsed.success) {
      throw new OrderStorageError("corrupt", "This order record is damaged and cannot be read.");
    }
    return parsed.data;
  } catch (error) {
    throw storageError("open the order", error);
  }
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
  if (!isOrderStatus(status)) {
    throw new OrderStorageError("corrupt", "Unknown order status.");
  }
  const order = await getOrder(id);
  const next: Order = { ...order, status, updatedAt: nowIso() };
  try {
    await tx(ORDERS_STORE, "readwrite", ([store]) => idbPut(store, next));
    return next;
  } catch (error) {
    throw storageError("update the order", error);
  }
}

export async function deleteOrder(id: string): Promise<void> {
  try {
    await tx(ORDERS_STORE, "readwrite", ([store]) => idbDelete(store, id));
  } catch (error) {
    throw storageError("delete the order", error);
  }
}
