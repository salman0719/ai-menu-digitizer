"use client";

/**
 * The Orders tab picks its source from the session: signed in, the server
 * board (Step 10) so orders from other devices arrive live; signed out, the
 * Phase 1 local queue in IndexedDB. Both advance statuses in the same
 * direction (new → preparing → served), cancelling is explicit, and nothing
 * is ever auto-deleted.
 */

import { useCallback, useEffect, useState } from "react";

import {
  nextOrderStatus,
  orderCode,
  orderStatusLabel,
  orderTotal,
  type Order,
  type OrderStatus,
} from "@/features/orders/schema";
import {
  deleteOrder,
  listOrders,
  OrderStorageError,
  updateOrderStatus,
} from "@/features/orders/storage";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { formatTableLabel } from "@/features/orders/table-links";
import { authClient } from "@/lib/auth-client";
import { GuidanceCard } from "@/components/ui/guidance-card";

import { OrdersSkeleton, ServerOrdersBoard } from "./server-orders-board";

const REFRESH_MS = 5000;

/**
 * Signed in: the server board, where a phone's order shows up in seconds.
 * Signed out: the local queue, unchanged from Phase 1.
 */
export function OrdersBoard() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) {
    return <OrdersSkeleton />;
  }
  return session?.user ? <ServerOrdersBoard /> : <LocalOrdersBoard />;
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  new: "bg-amber-100 text-amber-900",
  preparing: "bg-sky-100 text-sky-900",
  served: "bg-green-100 text-green-900",
  cancelled: "bg-stone-200 text-stone-600",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function LocalOrdersBoard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [corruptCount, setCorruptCount] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listOrders();
      setOrders(result.orders);
      setCorruptCount(result.corruptCount);
      setState("ready");
      setError(null);
    } catch (loadError: unknown) {
      setState("error");
      setError(
        loadError instanceof OrderStorageError
          ? loadError.message
          : "Could not read the local order queue."
      );
    }
  }, []);

  useEffect(() => {
    // Kick the first read off the effect body: refresh() updates state, and
    // React prefers that from an async callback rather than synchronously here.
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  async function advance(order: Order) {
    const next = nextOrderStatus(order.status);
    if (next === order.status || busyId) return;
    setBusyId(order.id);
    try {
      await updateOrderStatus(order.id, next);
      await refresh();
    } catch (updateError: unknown) {
      setError(
        updateError instanceof OrderStorageError
          ? updateError.message
          : "Could not update that order."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(order: Order) {
    if (!window.confirm(`Cancel order #${orderCode(order.id)} for ${formatTableLabel(order.tableLabel)}?`))
      return;
    setBusyId(order.id);
    try {
      await updateOrderStatus(order.id, "cancelled");
      await refresh();
    } catch (cancelError: unknown) {
      setError(
        cancelError instanceof OrderStorageError
          ? cancelError.message
          : "Could not cancel that order."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(order: Order) {
    if (!window.confirm(`Delete order #${orderCode(order.id)} permanently?`)) return;
    setBusyId(order.id);
    try {
      await deleteOrder(order.id);
      await refresh();
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof OrderStorageError
          ? deleteError.message
          : "Could not delete that order."
      );
    } finally {
      setBusyId(null);
    }
  }

  const openCount = orders.filter((order) => order.status === "new").length;
  const activeCount = orders.filter(
    (order) => order.status === "new" || order.status === "preparing"
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-stone-900">Orders</h2>
          <p className="mt-1 text-sm text-stone-600">
            {orders.length === 0
              ? "Orders placed from table QR codes appear here."
              : `${activeCount} active · ${openCount} new · updated automatically`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {corruptCount > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {corruptCount} stored {corruptCount === 1 ? "order is" : "orders are"} unreadable and
          cannot be shown. They can be cleared by deleting the app&apos;s browser data.
        </p>
      )}

      {state === "loading" && orders.length === 0 ? (
        <OrdersSkeleton />
      ) : orders.length === 0 && !error ? (
        <GuidanceCard
          title="No orders yet"
          steps={[
            "Open a menu in My menus and print its table QR cards.",
            "Scan one with a phone to place a test order — it appears here within seconds.",
          ]}
          action={{ href: "/menus", label: "Go to My menus" }}
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => {
            const total = orderTotal(order.lines);
            const canAdvance = nextOrderStatus(order.status) !== order.status;
            return (
              <li key={order.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold text-stone-900">
                        {formatTableLabel(order.tableLabel)}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[order.status]}`}
                      >
                        {orderStatusLabel(order.status)}
                      </span>
                      <span className="text-xs font-medium text-stone-400">
                        #{orderCode(order.id)} · {formatTime(order.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-stone-500">{order.menuTitle}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-stone-900">
                    {formatPreviewPrice(total, null, order.currency)}
                  </p>
                </div>

                <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3">
                  {order.lines.map((line, index) => (
                    <li
                      key={`${line.menuItemId}-${line.variantName ?? "base"}-${index}`}
                      className="flex items-baseline justify-between gap-3 text-sm text-stone-700"
                    >
                      <span>
                        <span className="font-medium text-stone-900">{line.quantity}×</span>{" "}
                        {line.name}
                        {line.variantName && (
                          <span className="ml-1 text-xs text-stone-500">{line.variantName}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">
                        {line.unitPrice === null
                          ? "no price"
                          : formatPreviewPrice(line.unitPrice * line.quantity, null, order.currency)}
                      </span>
                    </li>
                  ))}
                </ul>

                {order.note && (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Note: {order.note}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {canAdvance && (
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => void advance(order)}
                      className="rounded-full bg-amber-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-50"
                    >
                      Mark {orderStatusLabel(nextOrderStatus(order.status)).toLowerCase()}
                    </button>
                  )}
                  {order.status !== "cancelled" && order.status !== "served" && (
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => void cancel(order)}
                      className="rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={busyId === order.id}
                    onClick={() => void remove(order)}
                    className="text-xs font-medium text-stone-500 underline hover:text-red-800 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
