/**
 * Shared diner-facing pieces of the table ordering screen: the page frame,
 * the add-to-order menu list, and total formatting. Used by both the local
 * (`/order`, IndexedDB) and server (`/r/<restaurant>/m/<menu>/order`,
 * published snapshot) flows so a diner sees the same menu whichever path
 * the café uses.
 *
 * Deliberately free of editing chrome and of any storage import: the server
 * page must not pull IndexedDB code into its bundle just to render a menu.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { MenuCategory, MenuItem } from "@/features/menu/schema";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";

/**
 * Loading placeholder for the diner-facing order surfaces: a menu card in
 * the shape the loaded content lands in, so a slow table connection shows
 * the page's outline instead of one centered line. `label` announces the
 * wait to assistive tech; the blocks themselves are decorative.
 */
export function OrderSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="rounded-2xl border border-stone-200 bg-white p-6"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <div className="mt-6 flex flex-col gap-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
            <Skeleton className="h-9 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrderShell({
  tableLabel,
  children,
}: {
  tableLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-700 text-base font-bold text-white"
          >
            E
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-stone-900">Eateryo</p>
            <p className="text-xs text-stone-500">Order from your table</p>
          </div>
        </div>
        {tableLabel && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            {formatTableLabel(tableLabel)}
          </span>
        )}
      </header>
      {children}
    </div>
  );
}

export function OrderMenuSection({
  category,
  currency,
  variantChoice,
  onVariantChange,
  onAdd,
  itemCount,
}: {
  category: MenuCategory;
  currency: string | null;
  variantChoice: Record<string, string>;
  onVariantChange: (itemId: string, name: string) => void;
  onAdd: (item: MenuItem) => void;
  /** Quantity of this exact item + variant already in the cart (0 when absent). */
  itemCount?: (item: MenuItem, variantName: string | null) => number;
}) {
  // Per-item confirmation: pops on every tap, gone ~2s later. A fresh tap
  // dismisses the visible pop instantly and replays it, so rapid taps
  // never stack or linger. Removal is timer-driven (animation end is
  // unreliable when the node remounts mid-flight).
  const [flash, setFlash] = useState<Record<string, number>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashSeq = useRef(0);
  useEffect(
    () => () => {
      for (const timer of Object.values(flashTimers.current)) clearTimeout(timer);
    },
    []
  );
  function hideFlash(itemId: string) {
    setFlash((current) => {
      if (!(itemId in current)) return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }
  function bumpFlash(itemId: string) {
    // Drop the visible pop first so the replay starts from a clean mount.
    hideFlash(itemId);
    flashSeq.current += 1;
    const seq = flashSeq.current;
    requestAnimationFrame(() => {
      const pending = flashTimers.current[itemId];
      if (pending !== undefined) clearTimeout(pending);
      setFlash((current) => ({ ...current, [itemId]: seq }));
      flashTimers.current[itemId] = setTimeout(() => {
        delete flashTimers.current[itemId];
        hideFlash(itemId);
      }, 2000);
    });
  }
  return (
    <section
      aria-label={category.name}
      className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
    >
      <h2 className="border-b border-stone-100 bg-stone-50 px-5 py-2.5 text-sm font-bold tracking-wide text-stone-800 uppercase">
        {category.name}
      </h2>
      <ul className="divide-y divide-stone-100">
        {category.items.map((item) => {
          const soldOut = item.available === false;
          const variantName = variantChoice[item.id] ?? item.variants[0]?.name ?? null;
          const variant = variantName
            ? item.variants.find((candidate) => candidate.name === variantName)
            : null;
          const price = variant ? variant.price : item.price;
          const inCart = itemCount?.(item, variantName) ?? 0;
          const tick = flash[item.id] ?? 0;
          return (
            <li key={item.id} className={`px-5 py-3.5 ${soldOut ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-stone-900">
                    <span>{item.name}</span>
                    {soldOut && (
                      <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
                        Sold out
                      </span>
                    )}
                  </p>
                  {item.description && (
                    <p className="mt-0.5 text-sm text-stone-600">{item.description}</p>
                  )}
                  {item.dietaryLabels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.dietaryLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-900"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-stone-900">
                  {formatPreviewPrice(price, null, currency)}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.variants.length > 0 && (
                  <label className="text-xs text-stone-600">
                    <span className="sr-only">Size for {item.name}</span>
                    <select
                      value={variant?.name ?? ""}
                      onChange={(event) => onVariantChange(item.id, event.target.value)}
                      className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
                    >
                      {item.variants.map((option) => (
                        <option key={option.name} value={option.name}>
                          {option.name}
                          {option.price !== null
                            ? ` — ${formatPreviewPrice(option.price, null, currency)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <span className="relative inline-flex">
                  {tick > 0 && (
                    <span
                      key={tick}
                      aria-hidden="true"
                      className="added-flash absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-green-800 px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-white shadow"
                    >
                      Added ✓
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={soldOut}
                    onClick={() => {
                      onAdd(item);
                      bumpFlash(item.id);
                    }}
                    className="rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {inCart > 0 ? `Add · ${inCart}` : "Add"}
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function formatOrderTotal(currency: string | null, total: number | null): string {
  if (total === null) return "—";
  return formatPreviewPrice(total, null, currency);
}

/**
 * Mobile cart shortcut: on small screens the "Your order" card sits below
 * the whole menu, so diners would scroll past everything to send. Once
 * something is in the cart this fixed bar shows the count + total and jumps
 * to the cart. Hidden on desktop (the sticky aside covers it) and while the
 * cart is empty (nothing to jump to). The spacer reserves room in the flow
 * so the bar never covers the Send button.
 */
export function StickyCartBar({
  itemCount,
  total,
  currency,
}: {
  itemCount: number;
  total: number | null;
  currency: string | null;
}) {
  if (itemCount === 0) return null;
  function scrollToCart() {
    document.getElementById("your-order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return (
    <>
      <div aria-hidden="true" className="h-16 lg:hidden" />
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 pt-3 backdrop-blur lg:hidden"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm text-stone-700">
            <span className="font-bold text-stone-900">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>{" "}· {formatOrderTotal(currency, total)}
          </p>
          <button
            type="button"
            onClick={scrollToCart}
            className="shrink-0 rounded-full bg-amber-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800 active:scale-95"
          >
            View order
          </button>
        </div>
      </div>
    </>
  );
}
