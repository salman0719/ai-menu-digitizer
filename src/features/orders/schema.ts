/**
 * Canonical order schema — the single source of truth for orders placed at a
 * table and for the staff board that reads them.
 *
 * Honesty rules match the menu schema: a line's price is whatever the menu
 * said, or `null` when the menu had no price. Totals are derived, never
 * stored, and become `null` as soon as any line is unpriced — a partial total
 * would be an invented number.
 *
 * Orders are snapshots: names, variant names, and prices are copied at the
 * moment of ordering, so later menu edits never rewrite history.
 */

import { z } from "zod";

export const ORDER_STATUSES = ["new", "preparing", "served", "cancelled"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orderStatusSchema = z.enum(ORDER_STATUSES);

export const orderLineSchema = z.object({
  menuItemId: z.string().min(1),
  name: z.string().min(1),
  /** Chosen size/tier, when the item has variants. */
  variantName: z.string().min(1).nullable().default(null),
  /** Price per unit as printed, or null when the menu had none. */
  unitPrice: z.number().nullable().default(null),
  quantity: z.number().int().positive(),
});

export const orderSchema = z.object({
  id: z.string().min(1),
  menuId: z.string().min(1),
  /** Menu title snapshot, so the board reads without loading the menu. */
  menuTitle: z.string().min(1),
  /** Free-form table label: "3", "Patio 2", "Bar". */
  tableLabel: z.string().min(1),
  currency: z.string().min(1).nullable(),
  note: z.string().nullable(),
  lines: z.array(orderLineSchema).min(1),
  status: orderStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type OrderLine = z.infer<typeof orderLineSchema>;
export type Order = z.infer<typeof orderSchema>;

export type OrderLineInput = Omit<OrderLine, "quantity"> & { quantity?: number };

/** Sum of priced lines, or null when any line has no price. */
export function orderTotal(lines: readonly OrderLine[]): number | null {
  if (lines.length === 0) return null;
  let cents = 0;
  for (const line of lines) {
    if (line.unitPrice === null) return null;
    cents += Math.round(line.unitPrice * 100) * line.quantity;
  }
  return cents / 100;
}

/**
 * Merge a new line into an existing cart: same item and variant increments
 * the quantity instead of adding a duplicate row.
 */
export function addLine(lines: readonly OrderLine[], input: OrderLineInput): OrderLine[] {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const next = lines.map((line) => ({ ...line }));
  const match = next.find(
    (line) => line.menuItemId === input.menuItemId && line.variantName === (input.variantName ?? null)
  );
  if (match) {
    match.quantity += quantity;
    return next;
  }
  next.push({
    menuItemId: input.menuItemId,
    name: input.name,
    variantName: input.variantName ?? null,
    unitPrice: input.unitPrice ?? null,
    quantity,
  });
  return next;
}

/** Change a line's quantity; quantity <= 0 removes the line. */
export function setLineQuantity(
  lines: readonly OrderLine[],
  index: number,
  quantity: number
): OrderLine[] {
  if (!Number.isInteger(quantity)) throw new Error("Quantity must be a whole number.");
  const next = lines.map((line) => ({ ...line }));
  if (index < 0 || index >= next.length) return next;
  if (quantity <= 0) {
    next.splice(index, 1);
    return next;
  }
  next[index].quantity = quantity;
  return next;
}

/** Short human-facing code derived from the id (e.g. "Order #4F2A9C"). */
export function orderCode(id: string): string {
  const compact = id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  return compact || "ORDER";
}

const NEXT_STATUS: Record<OrderStatus, OrderStatus> = {
  new: "preparing",
  preparing: "served",
  served: "served",
  cancelled: "cancelled",
};

export function nextOrderStatus(status: OrderStatus): OrderStatus {
  return NEXT_STATUS[status];
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Statuses a staff member can move an order to, in board order. */
export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "preparing":
      return "Preparing";
    case "served":
      return "Served";
    case "cancelled":
      return "Cancelled";
  }
}
