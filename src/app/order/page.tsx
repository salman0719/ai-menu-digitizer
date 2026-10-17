import { Suspense } from "react";

import { TableOrder } from "@/components/order/table-order";
import { parseTableLink } from "@/features/orders/table-links";

/**
 * `/order?menu=<menuId>&table=<label>` — the destination encoded in a table
 * QR code. The menu is read from this browser's storage by the client
 * component; this server page only parses the link.
 *
 * `searchParams` is request-time data, so it is read inside <Suspense>:
 * Next 16 otherwise refuses to prerender the route shell at all.
 */
export default function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<OrderShellPlaceholder />}>
      <OrderLink searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderLink({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const link = parseTableLink(await searchParams);
  return <TableOrder menuId={link?.menuId ?? null} tableLabel={link?.tableLabel ?? null} />;
}

function OrderShellPlaceholder() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <p className="text-sm text-stone-500" role="status">
        Loading the table…
      </p>
    </div>
  );
}
