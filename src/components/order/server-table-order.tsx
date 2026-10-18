"use client";

/**
 * Table ordering from a public link (Step 10): `/m/<slug>/order?table=<label>`.
 *
 * The menu arrives from the server (the published snapshot), so this works on
 * a phone that has never opened the app. The diner sends only item ids,
 * variants, and quantities; the kitchen's server copies names and prices and
 * recomputes the total, so nothing here is trusted as a price.
 *
 * Honest failure states: an unpublishable menu 404s before this renders, a
 * sold-out item stays disabled, and a rejected or rate-limited order says so
 * plainly instead of pretending it was sent.
 */

import { useState } from "react";

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { placeOrder } from "@/features/orders/client";
import {
  addLine,
  orderCode,
  orderTotal,
  setLineQuantity,
  type Order,
  type OrderLine,
} from "@/features/orders/schema";
import { SyncError } from "@/features/menus/sync";

import { OrderMenuSection, OrderShell, formatOrderTotal } from "./order-menu";

interface ServerTableOrderProps {
  slug: string;
  doc: MenuDocument;
  tableLabel: string;
  restaurantName: string;
}

export function ServerTableOrder({ slug, doc, tableLabel, restaurantName }: ServerTableOrderProps) {
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [note, setNote] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  const total = orderTotal(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const frame = "rounded-2xl border border-stone-200 bg-white";

  function chosenVariantName(item: MenuItem): string | null {
    if (item.variants.length === 0) return null;
    const chosen = variantChoice[item.id];
    if (chosen && item.variants.some((variant) => variant.name === chosen)) return chosen;
    return item.variants[0]?.name ?? null;
  }

  function addItem(item: MenuItem) {
    const variantName = chosenVariantName(item);
    const variant = variantName ? item.variants.find((v) => v.name === variantName) : null;
    setLines((current) =>
      addLine(current, {
        menuItemId: item.id,
        name: item.name,
        variantName,
        unitPrice: variant ? variant.price : item.price,
      })
    );
    setError(null);
  }

  async function sendOrder() {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await placeOrder({
        slug,
        tableLabel,
        note: note.trim() ? note : null,
        lines: lines.map((line) => ({
          menuItemId: line.menuItemId,
          variantName: line.variantName,
          quantity: line.quantity,
        })),
        website: honeypot,
      });
      setPlaced(order);
      setLines([]);
      setNote("");
    } catch (submitError: unknown) {
      setError(
        submitError instanceof SyncError
          ? submitError.code === "not_found"
            ? "This menu is no longer published. Ask staff for the current link."
            : submitError.message
          : "The order could not be sent. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (placed) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-sm font-semibold tracking-wider text-green-800 uppercase">
            Order received
          </p>
          <p className="mt-3 text-2xl font-bold text-stone-900">
            #{orderCode(placed.id)} · Table {placed.tableLabel}
          </p>
          <p className="mt-2 text-sm text-stone-600">
            {placed.lines.length} {placed.lines.length === 1 ? "line" : "lines"} ·{" "}
            {formatOrderTotal(placed.currency, orderTotal(placed.lines))}
          </p>
          <p className="mx-auto mt-4 max-w-md text-xs leading-5 text-stone-500">
            The kitchen sees this on their board right away. The total is confirmed when your order
            is prepared.
          </p>
          <button
            type="button"
            onClick={() => setPlaced(null)}
            className="mt-5 rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
          >
            Order something else
          </button>
        </div>
      </OrderShell>
    );
  }

  return (
    <OrderShell tableLabel={tableLabel}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <div className={`${frame} p-5`}>
            <p className="text-sm font-semibold tracking-wider text-amber-800 uppercase">
              {restaurantName} · Table {tableLabel}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-stone-900">
              {doc.title.trim() || "Untitled menu"}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Tap a dish to add it. No account or app needed.
            </p>
          </div>

          {doc.categories.map((category) => (
            <OrderMenuSection
              key={category.id}
              category={category}
              currency={doc.currency}
              variantChoice={variantChoice}
              onVariantChange={(itemId, name) =>
                setVariantChoice((current) => ({ ...current, [itemId]: name }))
              }
              onAdd={addItem}
            />
          ))}
        </div>

        <aside className={`${frame} h-fit p-5 lg:sticky lg:top-4`} aria-label="Your order">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-stone-900">Your order</h2>
            <span className="text-xs font-medium text-stone-500">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
          </div>

          {lines.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">
              Nothing added yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-stone-100">
              {lines.map((line, index) => (
                <li key={`${line.menuItemId}-${line.variantName ?? "base"}`} className="py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-stone-900">
                      {line.name}
                      {line.variantName && (
                        <span className="ml-1 text-xs font-normal text-stone-500">
                          {line.variantName}
                        </span>
                      )}
                    </p>
                    <p className="shrink-0 text-sm tabular-nums text-stone-800">
                      {line.unitPrice === null
                        ? "—"
                        : formatPreviewPrice(line.unitPrice * line.quantity, doc.currency, null)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.name}`}
                      onClick={() => setLines((current) => setLineQuantity(current, index, line.quantity - 1))}
                      className="h-7 w-7 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-amber-700"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${line.name}`}
                      onClick={() => setLines((current) => setLineQuantity(current, index, line.quantity + 1))}
                      className="h-7 w-7 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-amber-700"
                    >
                      +
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setLines((current) => setLineQuantity(current, index, 0))}
                      className="text-xs font-medium text-stone-500 underline hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <label htmlFor="order-note" className="mt-4 block text-xs font-semibold text-stone-600">
            Note for the kitchen (optional)
          </label>
          <textarea
            id="order-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={280}
            placeholder="Allergies, no onions…"
            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
          />

          {/*
            Honeypot: visually hidden, unreachable by keyboard, and ignored by
            real people. Only a script fills it, and the server refuses then.
          */}
          <label aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            Website
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </label>

          <div className="mt-4 flex items-baseline justify-between border-t border-stone-200 pt-3">
            <p className="text-sm font-medium text-stone-600">Total</p>
            <p className="text-lg font-bold tabular-nums text-stone-900">
              {formatOrderTotal(doc.currency, total)}
            </p>
          </div>
          {total === null && lines.length > 0 && (
            <p className="mt-1 text-xs text-amber-800">
              Some items have no price on the menu, so no total is shown. Staff confirm the price.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={lines.length === 0 || submitting}
            onClick={() => void sendOrder()}
            className="mt-4 w-full rounded-full bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Send order to the kitchen"}
          </button>
        </aside>
      </div>
    </OrderShell>
  );
}
