import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderShell } from "@/components/order/order-menu";
import { ServerTableOrder } from "@/components/order/server-table-order";
import { normalizeTableLabel } from "@/features/orders/table-links";
import { getPublishedMenuByPath } from "@/features/publishing/repo";
import { isSlug } from "@/features/publishing/slug";
import { getDb } from "@/lib/db";

/**
 * `/r/<restaurant>/m/<menu>/order?table=<label>` — the destination printed on
 * a menu's own table card (Step 10).
 *
 * Unlike the Phase 1 `/order?menu=<id>` link, this one carries no local id:
 * the menu comes from the server's published snapshot, so a stranger's phone
 * sees the real menu and can order. The address is the same one the public
 * menu page serves, scoped to the café, so two cafés with a "Lunch" menu keep
 * separate links. The page never serves an unpublished address (404 through
 * the segment's not-found page), and a link without a table says so instead
 * of guessing which table the diner is at.
 *
 * Like the public menu page, the address and the DB read are request-time
 * data, so the route is a shell plus streamed content.
 */

const loadPublishedMenu = cache(
  async (restaurantSlug: string, menuSlug: string) => {
    if (!isSlug(restaurantSlug) || !isSlug(menuSlug)) return null;
    return getPublishedMenuByPath(getDb(), restaurantSlug, menuSlug);
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
}): Promise<Metadata> {
  const { restaurantSlug, menuSlug } = await params;
  const page = await loadPublishedMenu(restaurantSlug, menuSlug);
  if (!page) {
    return {
      title: "Menu not published · Tablepass",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: `Order · ${page.doc.title.trim() || "Menu"} · Tablepass`,
    robots: { index: false, follow: false },
  };
}

export default function TableOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<OrderLoading />}>
      <TableOrderLink params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TableOrderLink({
  params,
  searchParams,
}: {
  params: Promise<{ restaurantSlug: string; menuSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { restaurantSlug, menuSlug } = await params;
  const query = await searchParams;
  const page = await loadPublishedMenu(restaurantSlug, menuSlug);
  if (!page) notFound();

  const tableParam = typeof query.table === "string" ? query.table : null;
  const tableLabel = normalizeTableLabel(tableParam);

  if (!tableLabel) {
    return (
      <OrderShell>
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-stone-900">This table link is incomplete</p>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            A table link includes the table number, like{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 text-xs">
              /r/{page.restaurantSlug}/m/{page.slug}/order?table=3
            </code>
            . Ask staff for a fresh QR code.
          </p>
        </div>
      </OrderShell>
    );
  }

  return (
    <ServerTableOrder
      slug={page.slug}
      doc={page.doc}
      tableLabel={tableLabel}
      restaurantName={page.restaurantName}
    />
  );
}

function OrderLoading() {
  return (
    <OrderShell>
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center" role="status">
        <p className="text-sm text-stone-600">Loading the menu…</p>
      </div>
    </OrderShell>
  );
}
