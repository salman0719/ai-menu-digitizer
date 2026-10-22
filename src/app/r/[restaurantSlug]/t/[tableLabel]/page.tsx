import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderShell } from "@/components/order/order-menu";
import { TableOrderTabs } from "@/components/order/table-order-tabs";
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
 * lists every live menu for the restaurant: open ones (publication live +
 * availability covering now) as orderable tabs, and menus outside their
 * hours as disabled tabs that reveal their opening times, so a diner can
 * tell a closed menu from a missing one.
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
      title: "Restaurant link isn’t live · Eateryo",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: label
      ? `${landing.restaurantName} · ${formatTableLabel(label)} · Eateryo`
      : `${landing.restaurantName} · Eateryo`,
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

  if (landing.menus.length === 0 && landing.closedMenus.length === 0) {
    return (
      <OrderShell tableLabel={tableLabel}>
        <div className={`${frame} p-5`}>
          <p className="text-sm font-semibold tracking-wider text-amber-800 uppercase">
            {landing.restaurantName} · {formatTableLabel(tableLabel)}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-stone-900">Order from your table</h1>
          <p className="mt-1 text-sm text-stone-600">Ask staff what’s being served right now.</p>
        </div>
        <div className={`${frame} p-8 text-center`}>
          <p className="text-lg font-semibold text-stone-900">Nothing being served right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
            {landing.restaurantName} has no menu open at the moment — the kitchen may be between
            services. Ask staff what’s on, or try again a little later.
          </p>
        </div>
      </OrderShell>
    );
  }

  return (
    <OrderShell tableLabel={tableLabel}>
      <div className={`${frame} p-5`}>
        <p className="text-sm font-semibold tracking-wider text-amber-800 uppercase">
          {landing.restaurantName} · {formatTableLabel(tableLabel)}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">Order from your table</h1>
        <p className="mt-1 text-sm text-stone-600">
          {landing.menus.length === 0
            ? "Nothing is being served right now — tap a menu to see when it opens."
            : landing.menus.length === 1
              ? "One menu is open — tap a dish to add it."
              : `${landing.menus.length} menus are open — browse the tabs or search them all at once.`}
        </p>
      </div>

      <TableOrderTabs
        restaurantName={landing.restaurantName}
        restaurantSlug={landing.restaurantSlug}
        tableLabel={tableLabel}
        menus={landing.menus.map((menu) => ({
          menuId: menu.menuId,
          menuSlug: menu.menuSlug,
          title: menu.title,
          doc: menu.doc,
        }))}
        closedMenus={landing.closedMenus}
      />
    </OrderShell>
  );
}
