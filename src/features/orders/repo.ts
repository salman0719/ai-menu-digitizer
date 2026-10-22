import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import {
  menu as menuTable,
  order as orderTable,
  orderLine as orderLineTable,
  orderRateLimit,
  restaurantMembership,
} from "@/lib/db/schema";
import { menuAvailabilitySchema } from "@/features/availability/schema";
import { isMenuOpenAt } from "@/features/availability/open-at";
import type { TenancyDb } from "@/features/tenancy/repo";
import {
  getPublishedMenuByPath,
  type PublishedMenuPage,
} from "@/features/publishing/repo";
import { getRestaurantBySlug } from "@/features/tables/repo";
import { menuDocumentSchema, type MenuDocument, type MenuItem } from "@/features/menu/schema";

import {
  canTransitionOrderStatus,
  orderSchema,
  orderStatusSchema,
  type Order,
  type OrderStatus,
} from "./schema";
import { normalizeTableLabel } from "./table-links";

/**
 * Server repository for table orders (Step 10).
 *
 * The public path never trusts the client: a diner sends item ids, variants,
 * and quantities only. Names and prices are copied from the published
 * snapshot the diner actually saw, quantities are capped, and the total is
 * computed here in integer cents — `null` as soon as any line is unpriced
 * (Phase 1 honesty, never a partial sum).
 *
 * The staff path is tenancy-scoped: orders are readable and changeable only
 * by members of the restaurant that owns them, and another tenant's order is
 * reported as `not_found` so ids cannot be probed. Status changes are
 * conditional on the `updatedAt` the caller saw; a concurrent change returns
 * `stale` with the current order instead of silently overwriting it.
 */

export type OrderRepoErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid"
  | "stale"
  | "menu_not_live"
  | "unknown_item"
  | "item_unavailable"
  | "rate_limited";

export class OrderRepoError extends Error {
  readonly code: OrderRepoErrorCode;
  /** For `stale`: the order as it stands on the server now. */
  readonly current: Order | null;

  constructor(code: OrderRepoErrorCode, message: string, current: Order | null = null) {
    super(message);
    this.name = "OrderRepoError";
    this.code = code;
    this.current = current;
  }
}

/** Payload caps — small enough to be cheap, generous for a real table. */
export const MAX_ORDER_LINES = 30;
export const MAX_LINE_QUANTITY = 20;
export const MAX_ORDER_NOTE_LENGTH = 280;
/** Orders allowed per caller per fixed one-minute window. */
export const ORDER_RATE_LIMIT_PER_WINDOW = 12;

export interface OrderLineRequest {
  menuItemId: string;
  variantName?: string | null;
  quantity: number;
}

export interface PlaceOrderInput {
  /** Public menu slug the diner ordered from. */
  slug: string;
  /** The café's public slug — the menu is resolved inside it. */
  restaurantSlug: string;
  tableLabel: string;
  note?: string | null;
  lines: OrderLineRequest[];
}

export interface TableOrderLineRequest extends OrderLineRequest {
  /** Public slug of the menu this line comes from. */
  menuSlug: string;
}

export interface PlaceTableOrderInput {
  /** Public restaurant slug from the table QR (`/r/<slug>/t/<table>`). */
  restaurantSlug: string;
  tableLabel: string;
  note?: string | null;
  lines: TableOrderLineRequest[];
}

export interface StaffOrderQuery {
  /** Return only orders changed after this ISO timestamp (incremental poll). */
  since?: string | null;
  /** Restrict to one restaurant (must be one the caller belongs to). */
  restaurantId?: string | null;
  limit?: number;
}

type OrderRow = typeof orderTable.$inferSelect;
type OrderLineRow = typeof orderLineTable.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}

/** Rows → the canonical `Order` wire shape (dollars, ISO timestamps). */
function toOrder(row: OrderRow, lines: OrderLineRow[]): Order {
  const parsed = orderSchema.safeParse({
    id: row.id,
    menuId: row.menuId,
    menuTitle: row.menuTitle,
    tableLabel: row.tableLabel,
    currency: row.currency,
    note: row.note,
    lines: lines.map((line) => ({
      menuItemId: line.menuItemId,
      name: line.name,
      variantName: line.variantName,
      unitPrice: line.unitPriceCents === null ? null : line.unitPriceCents / 100,
      quantity: line.quantity,
      menuId: line.menuId,
      menuTitle: line.menuTitle,
    })),
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
  if (!parsed.success) {
    // A stored row that no longer matches the canonical schema is a server
    // bug; failing loudly beats rendering a half-order on the board.
    throw new Error(`stored order ${row.id} failed canonical schema validation`);
  }
  return parsed.data;
}

/** Load the lines for a set of orders, grouped by order id. */
async function linesByOrderId(
  db: TenancyDb,
  orderIds: string[]
): Promise<Map<string, OrderLineRow[]>> {
  const grouped = new Map<string, OrderLineRow[]>();
  if (orderIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(orderLineTable)
    .where(inArray(orderLineTable.orderId, orderIds))
    .orderBy(asc(orderLineTable.orderId));
  for (const row of rows) {
    const list = grouped.get(row.orderId) ?? [];
    list.push(row);
    grouped.set(row.orderId, list);
  }
  return grouped;
}

function collectItems(doc: MenuDocument): Map<string, MenuItem> {
  const items = new Map<string, MenuItem>();
  for (const category of doc.categories) {
    for (const item of category.items) items.set(item.id, item);
  }
  return items;
}

/** Shared envelope checks: table label, note length, line-count caps. */
function validateOrderEnvelope(
  tableLabel: string,
  note: string | null | undefined,
  lineCount: number
): { tableLabel: string; note: string | null } {
  const label = normalizeTableLabel(tableLabel);
  if (!label) {
    throw new OrderRepoError("invalid", "A table label is required.");
  }
  const trimmed = note?.trim() ? note.trim() : null;
  if (trimmed && trimmed.length > MAX_ORDER_NOTE_LENGTH) {
    throw new OrderRepoError(
      "invalid",
      `Keep the note to ${MAX_ORDER_NOTE_LENGTH} characters or fewer.`
    );
  }
  if (lineCount === 0) {
    throw new OrderRepoError("invalid", "An order needs at least one line.");
  }
  if (lineCount > MAX_ORDER_LINES) {
    throw new OrderRepoError("invalid", `An order can have at most ${MAX_ORDER_LINES} lines.`);
  }
  return { tableLabel: label, note: trimmed };
}

interface ResolvedLine {
  menuItemId: string;
  name: string;
  variantName: string | null;
  unitPriceCents: number | null;
  quantity: number;
}

/** Resolve one client line against a published snapshot (never trust names/prices). */
function resolveOrderLine(items: Map<string, MenuItem>, request: OrderLineRequest): ResolvedLine {
  if (!Number.isInteger(request.quantity) || request.quantity < 1) {
    throw new OrderRepoError("invalid", "Every line needs a whole quantity of at least 1.");
  }
  if (request.quantity > MAX_LINE_QUANTITY) {
    throw new OrderRepoError(
      "invalid",
      `A single line is limited to ${MAX_LINE_QUANTITY} items.`
    );
  }
  const item = items.get(request.menuItemId);
  if (!item) {
    throw new OrderRepoError("unknown_item", "That item is not on the published menu.");
  }
  if (item.available === false) {
    throw new OrderRepoError("item_unavailable", `“${item.name}” is sold out.`);
  }

  const variantName = request.variantName?.trim() || null;
  if (item.variants.length > 0) {
    if (!variantName || !item.variants.some((variant) => variant.name === variantName)) {
      throw new OrderRepoError("invalid", `Choose a size for “${item.name}”.`);
    }
  } else if (variantName !== null) {
    throw new OrderRepoError("invalid", `“${item.name}” has no sizes to choose from.`);
  }
  const variant = variantName
    ? item.variants.find((candidate) => candidate.name === variantName) ?? null
    : null;
  const price = variant ? variant.price : item.price;

  return {
    menuItemId: item.id,
    name: item.name,
    variantName,
    unitPriceCents: price === null ? null : Math.round(price * 100),
    quantity: request.quantity,
  };
}

/** Refuse orders for a menu whose time windows do not cover `now`. */
async function assertMenuOpen(db: TenancyDb, menuId: string, now: Date): Promise<void> {
  const rows = await db
    .select({ availability: menuTable.availability })
    .from(menuTable)
    .where(eq(menuTable.id, menuId));
  const availability = menuAvailabilitySchema.safeParse(rows[0]?.availability ?? []);
  if (!availability.success) {
    throw new Error(`stored menu ${menuId} has invalid availability`);
  }
  if (!isMenuOpenAt(availability.data, now)) {
    throw new OrderRepoError("menu_not_live", "That menu is not being served right now.");
  }
}

/**
 * Place an order from a public table link. Anonymous by design — the diner
 * never signs in, and nothing about them is stored.
 *
 * Server-side recomputation: every line is resolved against the *published
 * snapshot* (the menu the diner saw), so a client cannot invent a name, a
 * price, or a total. Unpriced lines make the total `null`.
 */
export async function placeOrderFromSlug(
  db: TenancyDb,
  input: PlaceOrderInput
): Promise<Order> {
  const page = await getPublishedMenuByPath(db, input.restaurantSlug, input.slug);
  if (!page) {
    throw new OrderRepoError("menu_not_live", "This menu is not published.");
  }
  const { tableLabel, note } = validateOrderEnvelope(input.tableLabel, input.note, input.lines.length);
  await assertMenuOpen(db, page.menuId, new Date());

  const doc = menuDocumentSchema.parse(page.doc);
  const items = collectItems(doc);

  const lines = input.lines.map((request) => ({
    ...resolveOrderLine(items, request),
    menuId: page.menuId,
    menuTitle: doc.title,
  }));

  const totalCents = lines.some((line) => line.unitPriceCents === null)
    ? null
    : lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.quantity, 0);

  const now = new Date();
  const inserted = await db
    .insert(orderTable)
    .values({
      restaurantId: page.restaurantId,
      menuId: page.menuId,
      menuTitle: doc.title,
      tableLabel,
      currency: doc.currency,
      note,
      status: "new",
      totalCents,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("order creation did not produce a row");

  try {
    const insertedLines = await db
      .insert(orderLineTable)
      .values(lines.map((line) => ({ ...line, orderId: row.id })))
      .returning();
    return toOrder(row, insertedLines);
  } catch (error) {
    // The Neon HTTP driver has no interactive transactions: compensate so a
    // half-written order can never appear on the board.
    await db.delete(orderTable).where(eq(orderTable.id, row.id)).catch(() => undefined);
    throw error;
  }
}

/**
 * Place one combined order across several menus from a table QR
 * (`/r/<restaurant>/t/<table>`). Each line names its menu, and the server
 * resolves every line against that menu's own published snapshot — a diner
 * still sends ids, variants, and quantities only.
 *
 * Every menu must be live, belong to the same restaurant the QR names, and
 * be open right now; otherwise the whole order is refused (no partial
 * ticket). The order row carries no single menu id — each line remembers
 * its own — and the display title joins the distinct menu titles.
 */
export async function placeTableOrder(
  db: TenancyDb,
  input: PlaceTableOrderInput
): Promise<Order> {
  const { tableLabel, note } = validateOrderEnvelope(
    input.tableLabel,
    input.note,
    input.lines.length
  );
  const restaurant = await getRestaurantBySlug(db, input.restaurantSlug);
  if (!restaurant) {
    throw new OrderRepoError("menu_not_live", "This restaurant link is not live.");
  }

  const now = new Date();
  const pages = new Map<string, PublishedMenuPage>();
  for (const request of input.lines) {
    if (!pages.has(request.menuSlug)) {
      // Resolved inside this restaurant only: a menu slug that names
      // another café's menu answers exactly like an unpublished one, so the
      // slug gives away nothing about other tenants.
      const page = await getPublishedMenuByPath(db, input.restaurantSlug, request.menuSlug);
      if (!page) {
        throw new OrderRepoError("menu_not_live", "One of these menus is no longer published.");
      }
      pages.set(request.menuSlug, page);
    }
  }
  for (const page of pages.values()) {
    await assertMenuOpen(db, page.menuId, now);
  }

  const snapshots = new Map<string, { items: Map<string, MenuItem>; title: string }>();
  for (const page of pages.values()) {
    const doc = menuDocumentSchema.parse(page.doc);
    snapshots.set(page.menuId, { items: collectItems(doc), title: doc.title });
  }

  const lines = input.lines.map((request) => {
    const page = pages.get(request.menuSlug);
    if (!page) throw new Error(`unresolved menu slug ${request.menuSlug}`);
    const snapshot = snapshots.get(page.menuId);
    if (!snapshot) throw new Error(`unresolved menu ${page.menuId}`);
    return {
      ...resolveOrderLine(snapshot.items, request),
      menuId: page.menuId,
      menuTitle: snapshot.title,
    };
  });

  const totalCents = lines.some((line) => line.unitPriceCents === null)
    ? null
    : lines.reduce((sum, line) => sum + (line.unitPriceCents ?? 0) * line.quantity, 0);

  const titles: string[] = [];
  for (const page of pages.values()) {
    const title = snapshots.get(page.menuId)?.title ?? "";
    if (title && !titles.includes(title)) titles.push(title);
  }

  const inserted = await db
    .insert(orderTable)
    .values({
      restaurantId: restaurant.id,
      menuId: null,
      menuTitle: titles.length > 0 ? titles.join(" + ") : restaurant.name,
      tableLabel,
      currency: orderCurrency([...pages.values()].map((page) => page.doc)),
      note,
      status: "new",
      totalCents,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("order creation did not produce a row");

  try {
    const insertedLines = await db
      .insert(orderLineTable)
      .values(lines.map((line) => ({ ...line, orderId: row.id })))
      .returning();
    return toOrder(row, insertedLines);
  } catch (error) {
    await db.delete(orderTable).where(eq(orderTable.id, row.id)).catch(() => undefined);
    throw error;
  }
}

/** One currency for the ticket when every menu agrees, else null (honest). */
function orderCurrency(docs: MenuDocument[]): string | null {
  const distinct = new Set(docs.map((doc) => doc.currency));
  if (distinct.size !== 1) return null;
  return docs[0]?.currency ?? null;
}


/**
 * Board query (owner or staff). Without `since` it returns the newest orders;
 * with it, everything changed after that timestamp (ascending) so status
 * edits reach other devices too, not just new orders.
 */
export async function listOrdersForStaff(
  db: TenancyDb,
  userId: string,
  query: StaffOrderQuery = {}
): Promise<{ orders: Order[]; serverTime: string }> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
  const since = query.since ? new Date(query.since) : null;
  if (query.since && Number.isNaN(since?.getTime())) {
    throw new OrderRepoError("invalid", "since must be an ISO 8601 timestamp.");
  }
  if (query.restaurantId) {
    const membership = await db
      .select({ id: restaurantMembership.id })
      .from(restaurantMembership)
      .where(
        and(
          eq(restaurantMembership.userId, userId),
          eq(restaurantMembership.restaurantId, query.restaurantId)
        )
      );
    if (membership.length === 0) {
      throw new OrderRepoError("not_found", "That restaurant does not exist.");
    }
  }

  // Captured before the query: the next poll asks for anything newer than
  // this, so a row committed mid-query cannot fall between the two windows.
  const serverTime = new Date();

  const conditions = [eq(restaurantMembership.userId, userId)];
  if (query.restaurantId) conditions.push(eq(orderTable.restaurantId, query.restaurantId));
  if (since) conditions.push(gt(orderTable.updatedAt, since));

  const rows = await db
    .select({ order: orderTable })
    .from(orderTable)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, orderTable.restaurantId))
    .where(and(...conditions))
    .orderBy(since ? asc(orderTable.updatedAt) : desc(orderTable.createdAt))
    .limit(limit);

  const orderRows = rows.map((entry) => entry.order);
  const lines = await linesByOrderId(
    db,
    orderRows.map((row) => row.id)
  );
  return {
    orders: orderRows.map((row) => toOrder(row, lines.get(row.id) ?? [])),
    serverTime: iso(serverTime),
  };
}

/** One order for a member of its restaurant (owner or staff), or null. */
export async function getOrderForStaff(
  db: TenancyDb,
  userId: string,
  orderId: string
): Promise<Order | null> {
  const rows = await db
    .select({ order: orderTable })
    .from(orderTable)
    .innerJoin(restaurantMembership, eq(restaurantMembership.restaurantId, orderTable.restaurantId))
    .where(and(eq(orderTable.id, orderId), eq(restaurantMembership.userId, userId)));
  const row = rows[0]?.order;
  if (!row) return null;
  const lines = await linesByOrderId(db, [row.id]);
  return toOrder(row, lines.get(row.id) ?? []);
}

/**
 * Move an order forward (or cancel it). `expectedUpdatedAt` makes the write
 * conditional: two devices updating the same order converge through a
 * `stale` result rather than the later write silently winning.
 */
export async function updateOrderStatusForStaff(
  db: TenancyDb,
  userId: string,
  orderId: string,
  status: OrderStatus,
  expectedUpdatedAt?: string | null
): Promise<Order> {
  if (!orderStatusSchema.safeParse(status).success) {
    throw new OrderRepoError("invalid", "Unknown order status.");
  }
  const current = await getOrderForStaff(db, userId, orderId);
  if (!current) {
    throw new OrderRepoError("not_found", "That order does not exist.");
  }
  if (!canTransitionOrderStatus(current.status, status)) {
    throw new OrderRepoError(
      "invalid",
      `An order cannot move from ${current.status} to ${status}.`
    );
  }
  if (current.status === status) return current;

  const now = new Date();
  const conditions = [eq(orderTable.id, orderId)];
  if (expectedUpdatedAt) {
    const expected = new Date(expectedUpdatedAt);
    if (Number.isNaN(expected.getTime())) {
      throw new OrderRepoError("invalid", "expectedUpdatedAt must be an ISO 8601 timestamp.");
    }
    conditions.push(eq(orderTable.updatedAt, expected));
  }

  const updated = await db
    .update(orderTable)
    .set({ status, updatedAt: now })
    .where(and(...conditions))
    .returning();

  if (updated.length === 0) {
    const fresh = await getOrderForStaff(db, userId, orderId);
    throw new OrderRepoError(
      "stale",
      "This order was changed elsewhere since you last saw it.",
      fresh
    );
  }

  const lines = await linesByOrderId(db, [orderId]);
  return toOrder(updated[0], lines.get(orderId) ?? []);
}

/**
 * Count one order attempt against a fixed-window bucket. The bucket key is
 * supplied by the route (a hash — no raw address is stored) and already
 * includes the window; the upsert is atomic, so concurrent attempts on
 * different instances still share one count.
 */
export async function consumeOrderRateLimit(
  db: TenancyDb,
  bucket: string,
  now: Date,
  limit: number = ORDER_RATE_LIMIT_PER_WINDOW
): Promise<{ allowed: boolean; count: number }> {
  const rows = await db
    .insert(orderRateLimit)
    .values({ key: bucket, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: orderRateLimit.key,
      set: { count: sql`${orderRateLimit.count} + 1` },
    })
    .returning({ count: orderRateLimit.count });
  const count = rows[0]?.count ?? 1;
  return { allowed: count <= limit, count };
}
