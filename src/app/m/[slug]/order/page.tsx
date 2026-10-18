import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderShell } from "@/components/order/order-menu";
import { ServerTableOrder } from "@/components/order/server-table-order";
import { normalizeTableLabel } from "@/features/orders/table-links";
import { getPublishedMenuBySlug } from "@/features/publishing/repo";
import { isSlug } from "@/features/publishing/slug";
import { getDb } from "@/lib/db";

/**
 * `/m/<slug>/order?table=<label>` — the destination printed on table cards for
 * a published menu (Step 10).
 *
 * Unlike the Phase 1 `/order?menu=<id>` link, this one carries no local id:
 * the menu comes from the server's published snapshot, so a stranger's phone
 * sees the real menu and can order. The page never serves an unpublished slug
 * (404 through the segment's not-found page), and a link without a table says
 * so instead of guessing which table the diner is at.
 *
 * Like the public menu page, the slug and the DB read are request-time data,
 * so the route is a shell plus streamed content.
 */

const loadPublishedMenu = cache(async (slug: string) => {
  if (!isSlug(slug)) return null;
  return getPublishedMenuBySlug(getDb(), slug);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPublishedMenu(slug);
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
  params: Promise<{ slug: string }>;
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
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const page = await loadPublishedMenu(slug);
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
              /m/{page.slug}/order?table=3
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
