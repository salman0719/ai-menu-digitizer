"use client";

/**
 * Table ordering screen reached from a table QR code:
 * `/order?menu=<menuId>&table=<label>`.
 *
 * The menu lives in this browser's IndexedDB, so the page loads it directly —
 * no server call, nothing leaves the device. A QR scanned on a phone that
 * does not share this storage says so honestly and offers the clearly
 * labelled demo menu instead of pretending the link works.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MenuDocument, MenuItem } from "@/features/menu/schema";
import {
  addLine,
  orderCode,
  orderTotal,
  setLineQuantity,
  type Order,
  type OrderLine,
} from "@/features/orders/schema";
import { createOrder, OrderStorageError } from "@/features/orders/storage";
import { formatTableLabel } from "@/features/orders/table-links";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { getMenu, StorageError } from "@/features/menu/storage";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

import {
  OrderMenuSection as MenuSection,
  OrderShell as Shell,
  OrderSkeleton,
  formatOrderTotal as formatTotal,
} from "./order-menu";

type LoadState = "idle" | "loading" | "ready" | "missing" | "error" | "invalid_link";

interface TableOrderProps {
  menuId: string | null;
  tableLabel: string | null;
}

export function TableOrder({ menuId, tableLabel }: TableOrderProps) {
  // A missing menu/table in the link is known at mount, so no effect is needed
  // to report it; the effect below only loads data.
  const [state, setState] = useState<LoadState>(menuId && tableLabel ? "loading" : "invalid_link");
  const [menu, setMenu] = useState<MenuDocument | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [note, setNote] = useState("");
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!menuId || !tableLabel) return;
    getMenu(menuId)
      .then((doc) => {
        if (cancelled) return;
        setMenu(doc);
        setState("ready");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        if (loadError instanceof StorageError || loadError instanceof Error) {
          setState("missing");
          return;
        }
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [menuId, tableLabel]);

  const total = orderTotal(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  function loadDemo() {
    setMenu(createSampleMenuDocument());
    setIsDemo(true);
    setLines([]);
    setPlaced(null);
    setState("ready");
  }

  function chosenVariantName(item: MenuItem): string | null {
    if (item.variants.length === 0) return null;
    const chosen = variantChoice[item.id];
    if (chosen && item.variants.some((variant) => variant.name === chosen)) return chosen;
    return item.variants[0]?.name ?? null;
  }

  function addItem(item: MenuItem) {
    if (!menu) return;
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

  function changeQuantity(index: number, quantity: number) {
    setLines((current) => setLineQuantity(current, index, quantity));
  }

  async function placeOrder() {
    if (!menu || lines.length === 0 || !tableLabel || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        menuId: menu.id,
        menuTitle: isDemo ? `${menu.title} (demo)` : menu.title,
        tableLabel,
        currency: menu.currency,
        note,
        lines,
      });
      setPlaced(order);
      setLines([]);
      setNote("");
    } catch (submitError: unknown) {
      setError(
        submitError instanceof OrderStorageError
          ? submitError.message
          : "The order could not be saved in this browser. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const frame = "rounded-2xl border border-stone-200 bg-white";

  if (state === "invalid_link") {
    return (
      <Shell>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-lg font-semibold text-stone-900">This table link is incomplete</p>
          <p className="mt-2 text-sm text-stone-600">
            A table link looks like <code>/order?menu=…&amp;table=3</code>. Ask staff for a fresh QR
            code.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === "loading" || state === "idle") {
    return (
      <Shell>
        <OrderSkeleton label="Loading the menu…" />
      </Shell>
    );
  }

  if (state === "missing" || state === "error") {
    return (
      <Shell>
        <div className={`${frame} p-8`}>
          <p className="text-lg font-semibold text-stone-900">
            This menu isn&apos;t on this device
          </p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Menus are stored in the browser that created them. This link points at a menu saved
            somewhere else — table links work on the device holding the menu, or anywhere the same
            browser storage is available.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadDemo}
              className="rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
            >
              Try the demo menu
            </button>
            <Link
              href="/"
              className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900"
            >
              Back to the app
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!menu || !tableLabel) return null;

  if (placed) {
    return (
      <Shell tableLabel={tableLabel}>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-sm font-semibold tracking-wider text-green-800 uppercase">
            Order received
          </p>
          <p className="mt-3 text-2xl font-bold text-stone-900">
            #{orderCode(placed.id)} · {formatTableLabel(placed.tableLabel)}
          </p>
          <p className="mt-2 text-sm text-stone-600">
            {placed.lines.length} {placed.lines.length === 1 ? "line" : "lines"} ·{" "}
            {formatTotal(placed.currency, orderTotal(placed.lines))}
          </p>
          <p className="mx-auto mt-4 max-w-md text-xs leading-5 text-stone-500">
            Saved in this browser for staff to pick up. Nothing has been sent to a server.
          </p>
          <button
            type="button"
            onClick={() => setPlaced(null)}
            className="mt-5 rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
          >
            Order something else
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell tableLabel={tableLabel}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <div className={`${frame} p-5`}>
            <p className="text-sm font-semibold tracking-wider text-amber-800 uppercase">
              {formatTableLabel(tableLabel)}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-stone-900">
              {menu.title.trim() || "Untitled menu"}
            </h1>
            <p className="mt-1 text-sm text-stone-600">
              Tap a dish to add it to your order. Prices are exactly what the menu shows.
            </p>
            {isDemo && (
              <p className="mt-3 inline-block rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                Demo menu — not a real restaurant
              </p>
            )}
          </div>

          {menu.categories.map((category) => (
            <MenuSection
              key={category.id}
              category={category}
              currency={menu.currency}
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
                        : formatPreviewPrice(line.unitPrice * line.quantity, menu.currency, null)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.name}`}
                      onClick={() => changeQuantity(index, line.quantity - 1)}
                      className="h-7 w-7 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-amber-700"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${line.name}`}
                      onClick={() => changeQuantity(index, line.quantity + 1)}
                      className="h-7 w-7 rounded-full border border-stone-300 text-sm font-semibold text-stone-700 hover:border-amber-700"
                    >
                      +
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => changeQuantity(index, 0)}
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
            placeholder="Allergies, no onions…"
            className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
          />

          <div className="mt-4 flex items-baseline justify-between border-t border-stone-200 pt-3">
            <p className="text-sm font-medium text-stone-600">Total</p>
            <p className="text-lg font-bold tabular-nums text-stone-900">
              {formatTotal(menu.currency, total)}
            </p>
          </div>
          {total === null && lines.length > 0 && (
            <p className="mt-1 text-xs text-amber-800">
              Some items have no price on the menu, so no total is shown.
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
            onClick={() => void placeOrder()}
            className="mt-4 w-full rounded-full bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Sending…" : "Send order"}
          </button>
        </aside>
      </div>
    </Shell>
  );
}

