import { Suspense, cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderShell } from "@/components/order/order-menu";
import { isSlug } from "@/features/publishing/slug";
import { normalizeTableLabel, formatTableLabel } from "@/features/orders/table-links";
import {
  listOpenMenusForRestaurantSlug,
  type TableLanding,
} from "@/features/tables/repo";
import { getDb } from "@/lib/db";

/**
 * Per-table landing (Steps 1–2): `/r/<restaurant>/t/<table>`.
 *
 * One QR code per table resolves here — not to a single menu. The page
 * lists every currently-open menu for the restaurant (live publication +
 * availability windows covering now) and links each one into the existing
 * per-menu order flow. Step 3 will turn these links into tabs with a shared
 * cart; until then the landing is already useful: a diner sees what is
 * being served and taps through to order.
 *
 * No account, no cookie: a stranger's phone sees exactly the open menus.
 * Unknown restaurant slugs 404; a known restaurant with nothing open gets
 * an honest empty state instead of a dead page.
 */

const loadLanding = cache(
  async (restaurantSlug: string): Promise<TableLanding | null> => {
    if (!isSlug(restaurantSlug)) return null;
    return listOpenMenusForRestaurantSlug(getDb(), restaurantSlug, new Date());
  }
);

function itemCount(doc: { categories: { items: unknown[] }[] }): number {
  return doc.categories.reduce((sum, category) => sum + category.items.length, 0);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
}): Promise<Metadata> {
  const { restaurantSlug, tableLabel } = await params;
  const landing = await loadLanding(restaurantSlug);
  const label = normalizeTableLabel(decodeURIComponent(tableLabel));
  if (!landing) {
    return {
      title: "Restaurant link isn’t live · Tablepass",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: label
      ? `${landing.restaurantName} · ${formatTableLabel(label)} · Tablepass`
      : `${landing.restaurantName} · Tablepass`,
    robots: { index: false, follow: false },
  };
}

export default function TableLandingPage({
  params,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
}) {
  return (
    <Suspense fallback={<LandingLoading />}>
      <TableLandingContent params={params} />
    </Suspense>
  );
}

function LandingLoading() {
  return (
    <OrderShell>
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center" role="status">
        <p className="text-sm text-stone-600">Finding this table’s menus…</p>
      </div>
    </OrderShell>
  );
}

async function TableLandingContent({
  params,
}: {
  params: Promise<{ restaurantSlug: string; tableLabel: string }>;
}) {
  const { restaurantSlug, tableLabel: rawLabel } = await params;
  const landing = await loadLanding(restaurantSlug);
  if (!landing) notFound();

  const tableLabel = normalizeTableLabel(decodeURIComponent(rawLabel));
  if (!tableLabel) {
    return (
      <OrderShell>
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-stone-900">This table link is incomplete</p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            A table link includes the table number, like{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
              /r/{landing.restaurantSlug}/t/3
            </code>
            . Ask staff for a fresh QR code.
          </p>
        </div>
      </OrderShell>
    );
  }

  const frame = "rounded-2xl border border-stone-200 bg-white";

  return (
    <OrderShell tableLabel={tableLabel}>
      <div className={`${frame} p-5`}>
        <p className="text-sm font-semibold tracking-wider text-amber-800 uppercase">
          {landing.restaurantName} · {formatTableLabel(tableLabel)}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">
          What’s on{landing.menus.length > 1 ? ` — ${landing.menus.length} menus` : ""}
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          {landing.menus.length === 0
            ? "Ask staff what’s being served right now."
            : "Pick a menu to start an order. No account or app needed."}
        </p>
      </div>

      {landing.menus.length === 0 ? (
        <div className={`${frame} p-8 text-center`}>
          <p className="text-lg font-semibold text-stone-900">Nothing being served right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
            {landing.restaurantName} has no menu open at the moment — the kitchen may be between
            services. Ask staff what’s on, or try again a little later.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {landing.menus.map((menu) => {
            const items = itemCount(menu.doc);
            const orderHref = `/m/${menu.menuSlug}/order?table=${encodeURIComponent(tableLabel)}`;
            return (
              <li key={menu.menuId} className={`${frame} flex flex-col p-5`}>
                <h2 className="text-lg font-bold text-stone-900">
                  {menu.doc.title.trim() || "Untitled menu"}
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  {items === 0
                    ? "No items listed."
                    : `${items} ${items === 1 ? "item" : "items"} across ${menu.doc.categories.length} ${menu.doc.categories.length === 1 ? "category" : "categories"}`}
                </p>
                <span className="flex-1" />
                <Link
                  href={orderHref}
                  className="mt-4 inline-block rounded-full bg-amber-700 px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-amber-800"
                >
                  View &amp; order
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OrderShell>
  );
}
