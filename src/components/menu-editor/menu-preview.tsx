"use client";

/**
 * Customer-facing view of the current menu document — what a diner would
 * see. Rendered live from the editor's `doc`, so unsaved edits show up as
 * you type. Deliberately free of editing chrome: no review badges, no
 * review notes, no controls — review happens in the editor (PLAN.md: AI
 * output is a draft, and the human review surface is not the preview).
 *
 * Appearance comes from `preview-themes.ts`; this component only applies the
 * tokens. A "Preview · not published" label stays visible so this never reads
 * as a published page (publishing a public site is out of scope). Unset prices
 * render as an em dash; nothing is ever invented.
 */

import type { MenuDocument } from "@/features/menu/schema";
import { formatPreviewPrice, formatPriceDelta } from "@/features/menu/preview-utils";
import { previewTheme, type PreviewThemeId } from "@/features/menu/preview-themes";

interface MenuPreviewProps {
  doc: MenuDocument;
  /** Chosen visual theme; defaults to Classic. */
  themeId?: PreviewThemeId | null;
}

export function MenuPreview({ doc, themeId }: MenuPreviewProps) {
  const theme = previewTheme(themeId);
  const itemCount = doc.categories.reduce((sum, category) => sum + category.items.length, 0);

  return (
    <div className={`flex flex-col gap-4 ${theme.font}`}>
      <div className={`rounded-2xl px-6 py-10 ${theme.page} ${theme.headerAlign}`}>
        <p className={theme.eyebrow}>Preview · not published</p>
        <h2 className={`mt-2 ${theme.title}`}>{doc.title.trim() || "Untitled menu"}</h2>
        {doc.categories.length > 0 && (
          <p className={`mt-3 text-sm ${theme.description}`}>
            {doc.categories.length} {doc.categories.length === 1 ? "category" : "categories"} ·{" "}
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </p>
        )}
        <span
          aria-hidden="true"
          className={`mx-auto mt-5 block w-16 border-t ${theme.sectionRule}`}
        />
      </div>

      {doc.categories.length === 0 ? (
        <div className={`rounded-2xl p-8 text-center ${theme.page}`}>
          <p className={`font-medium ${theme.itemName}`}>Nothing on the menu yet</p>
          <p className={`mt-1 text-sm ${theme.description}`}>
            Add a category and items to see them here.
          </p>
        </div>
      ) : (
        doc.categories.map((category) => (
          <section
            key={category.id}
            aria-label={`Menu category ${category.name}`}
            className={`rounded-2xl px-6 py-6 ${theme.page}`}
          >
            <h3 className={theme.sectionHeading}>{category.name}</h3>
            {category.items.length === 0 ? (
              <p className={`mt-3 text-sm italic ${theme.description}`}>Nothing listed yet.</p>
            ) : (
              <ul className={`mt-2 divide-y ${theme.sectionRule}`}>
                {category.items.map((item) => {
                  const soldOut = item.available === false;
                  return (
                    <li key={item.id} className={`py-3 ${soldOut ? "opacity-60" : ""}`}>
                      <div className="flex items-baseline gap-2">
                        <p className={theme.itemName}>
                          {item.name}
                          {soldOut && (
                            <span
                              className={`ml-2 rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold ${theme.badge}`}
                            >
                              Sold out
                            </span>
                          )}
                        </p>
                        <span
                          aria-hidden="true"
                          className={`mx-1 flex-1 translate-y-[-2px] border-b border-dotted ${theme.leader}`}
                        />
                        {(item.price !== null || item.variants.length === 0) && (
                          <p className={`shrink-0 text-sm ${theme.price}`}>
                            {formatPreviewPrice(item.price, item.currency, doc.currency)}
                          </p>
                        )}
                      </div>

                      {item.description && (
                        <p className={`mt-0.5 text-sm ${theme.description}`}>{item.description}</p>
                      )}

                      {item.variants.length > 0 && (
                        <ul className={`mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs ${theme.variantName}`}>
                          {item.variants.map((variant, vIndex) => (
                            <li key={`${variant.name}-${vIndex}`} className="tabular-nums">
                              {variant.name}
                              <span className={`ml-1.5 ${theme.variantPrice}`}>
                                {formatPreviewPrice(variant.price, null, doc.currency)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {item.options.length > 0 && (
                        <ul className={`mt-1.5 space-y-1 text-xs ${theme.variantName}`}>
                          {item.options.map((option, oIndex) => (
                            <li key={`${option.name}-${oIndex}`}>
                              <span className="font-semibold">{option.name}:</span>{" "}
                              {option.choices.length === 0
                                ? "ask staff"
                                : option.choices.map((choice, cIndex) => (
                                    <span key={`${choice.name}-${cIndex}`}>
                                      {cIndex > 0 && ", "}
                                      {choice.name}
                                      {choice.priceDelta !== null && (
                                        <span className={`ml-1 ${theme.variantPrice}`}>
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
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${theme.badge}`}
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

      {doc.currency && (
        <p className={`px-2 text-center text-[11px] tracking-wide ${theme.description}`}>
          Prices in {doc.currency} as printed on the menu.
        </p>
      )}
    </div>
  );
}
