"use client";

/**
 * Customer-facing view of the current menu document — what a diner would
 * see. Rendered live from the editor's `doc`, so unsaved edits show up as
 * you type. Deliberately free of editing chrome: no review badges, no
 * review notes, no controls — review happens in the editor (PLAN.md: AI
 * output is a draft, and the human review surface is not the preview).
 *
 * A "Preview" label stays visible so this never reads as a published page
 * (publishing a public site is out of scope). Unset prices render as an em
 * dash; nothing is ever invented.
 */

import type { MenuDocument } from "@/features/menu/schema";
import { formatPreviewPrice, formatPriceDelta } from "@/features/menu/preview-utils";

interface MenuPreviewProps {
  doc: MenuDocument;
}

export function MenuPreview({ doc }: MenuPreviewProps) {
  const itemCount = doc.categories.reduce((sum, category) => sum + category.items.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-stone-200 bg-white px-6 py-8 text-center">
        <h2 className="text-2xl font-bold text-stone-900 sm:text-3xl">
          {doc.title.trim() || "Untitled menu"}
        </h2>
        {doc.categories.length > 0 && (
          <p className="mt-2 text-sm text-stone-500">
            {doc.categories.length} {doc.categories.length === 1 ? "category" : "categories"} ·{" "}
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
        )}
        <p className="mt-3 text-[11px] font-semibold tracking-widest text-stone-400 uppercase">
          Preview — not published
        </p>
      </div>

      {doc.categories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">Nothing on the menu yet</p>
          <p className="mt-1 text-sm text-stone-600">Add a category and items to see them here.</p>
        </div>
      ) : (
        doc.categories.map((category) => (
          <section
            key={category.id}
            aria-label={`Menu category ${category.name}`}
            className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
          >
            <h3 className="border-b border-stone-100 bg-stone-50 px-5 py-3 text-sm font-bold tracking-wide text-stone-800 uppercase">
              {category.name}
            </h3>
            {category.items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-stone-400 italic">Nothing listed yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {category.items.map((item) => {
                  const soldOut = item.available === false;
                  return (
                    <li key={item.id} className={`px-5 py-4 ${soldOut ? "opacity-60" : ""}`}>
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="font-medium text-stone-900">
                          {item.name}
                          {soldOut && (
                            <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 align-middle text-[11px] font-semibold text-stone-600">
                              Sold out
                            </span>
                          )}
                        </p>
                        <p className="shrink-0 text-sm font-semibold text-stone-900 tabular-nums">
                          {formatPreviewPrice(item.price, item.currency, doc.currency)}
                        </p>
                      </div>

                      {item.description && (
                        <p className="mt-0.5 text-sm text-stone-600">{item.description}</p>
                      )}

                      {item.variants.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-stone-600">
                          {item.variants.map((variant, vIndex) => (
                            <li key={`${variant.name}-${vIndex}`} className="tabular-nums">
                              {variant.name}
                              <span className="ml-1.5 font-medium text-stone-800">
                                {formatPreviewPrice(variant.price, null, doc.currency)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {item.options.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-stone-600">
                          {item.options.map((option, oIndex) => (
                            <li key={`${option.name}-${oIndex}`}>
                              <span className="font-semibold text-stone-700">{option.name}:</span>{" "}
                              {option.choices.length === 0
                                ? "ask staff"
                                : option.choices.map((choice, cIndex) => (
                                    <span key={`${choice.name}-${cIndex}`}>
                                      {cIndex > 0 && ", "}
                                      {choice.name}
                                      {choice.priceDelta !== null && (
                                        <span className="ml-1 font-medium text-stone-800 tabular-nums">
                                          {formatPriceDelta(choice.priceDelta)}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                            </li>
                          ))}
                        </ul>
                      )}

                      {item.dietaryLabels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
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
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
