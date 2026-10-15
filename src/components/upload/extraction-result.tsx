"use client";

/**
 * Read-only summary of an extracted (or demo) menu. Takes the narrow
 * `PreviewMenu` shape so both AI results and stored documents render here
 * without adapters. The full editor (Step 4) replaces this as the workspace;
 * until then this is the review surface, not a placeholder.
 */

export interface PreviewItem {
  name: string;
  price: number | null;
  currency: string | null;
  description: string | null;
  available: boolean | null;
  dietaryLabels: string[];
  reviewNotes: string[];
}

export interface PreviewCategory {
  name: string;
  items: PreviewItem[];
}

export interface PreviewMenu {
  title: string | null;
  currency: string | null;
  categories: PreviewCategory[];
}

interface ExtractionResultProps {
  data: PreviewMenu;
  source: "ai" | "demo";
  onStartOver: () => void;
}

function formatPrice(item: PreviewItem, fallbackCurrency: string | null): string {
  if (item.price === null) return "Price needed";
  const currency = item.currency ?? fallbackCurrency ?? "";
  return `${currency ? `${currency} ` : ""}${item.price.toFixed(2)}`;
}

export function ExtractionResult({ data, source, onStartOver }: ExtractionResultProps) {
  const itemCount = data.categories.reduce((sum, c) => sum + c.items.length, 0);
  const reviewCount = data.categories.reduce(
    (sum, c) => sum + c.items.filter((i) => i.price === null || i.reviewNotes.length > 0).length,
    0
  );

  return (
    <section aria-label="Extraction result" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-stone-900">{data.title ?? "Untitled menu"}</h2>
            {source === "ai" ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                AI draft — review required
              </span>
            ) : (
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                Demo data
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {data.categories.length} {data.categories.length === 1 ? "category" : "categories"} ·{" "}
            {itemCount} {itemCount === 1 ? "item" : "items"}
            {reviewCount > 0 && (
              <span className="font-medium text-amber-800"> · {reviewCount} need review</span>
            )}
          </p>
          {source === "ai" && (
            <p className="mt-1 text-xs text-stone-500">
              Prices and names are a best-effort draft. Check anything marked before using it.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          Start over
        </button>
      </div>

      {data.categories.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <p className="font-medium text-stone-900">No menu content detected</p>
          <p className="mt-1 text-sm text-stone-600">
            The image may not show a menu, or the text was unreadable. Try a clearer photo.
          </p>
        </div>
      ) : (
        data.categories.map((category) => (
          <div
            key={category.name}
            className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
          >
            <h3 className="border-b border-stone-100 bg-stone-50 px-5 py-3 text-sm font-bold tracking-wide text-stone-800 uppercase">
              {category.name}
            </h3>
            <ul className="divide-y divide-stone-100">
              {category.items.map((item) => {
                const needsReview = item.price === null || item.reviewNotes.length > 0;
                return (
                  <li key={`${category.name}-${item.name}`} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium text-stone-900">
                        {item.name}
                        {item.available === false && (
                          <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 align-middle text-[11px] font-semibold text-stone-700">
                            Unavailable
                          </span>
                        )}
                      </p>
                      <p
                        className={
                          item.price === null
                            ? "shrink-0 text-sm font-semibold text-amber-800"
                            : "shrink-0 text-sm font-semibold text-stone-900"
                        }
                      >
                        {formatPrice(item, data.currency)}
                      </p>
                    </div>
                    {item.description && (
                      <p className="mt-0.5 text-sm text-stone-600">{item.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.dietaryLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-900"
                        >
                          {label}
                        </span>
                      ))}
                      {needsReview && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                          Needs review
                        </span>
                      )}
                    </div>
                    {item.reviewNotes.length > 0 && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                        {item.reviewNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
