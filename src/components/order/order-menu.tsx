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

import type { MenuCategory, MenuItem } from "@/features/menu/schema";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";

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
            T
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-stone-900">Tablepass</p>
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
}: {
  category: MenuCategory;
  currency: string | null;
  variantChoice: Record<string, string>;
  onVariantChange: (itemId: string, name: string) => void;
  onAdd: (item: MenuItem) => void;
}) {
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
                <button
                  type="button"
                  disabled={soldOut}
                  onClick={() => onAdd(item)}
                  className="rounded-full bg-stone-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add
                </button>
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
