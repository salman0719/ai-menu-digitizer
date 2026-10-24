"use client";

/**
 * Staff order board backed by the server (Step 10). Orders placed from a
 * public table link on another device appear here without a manual refresh.
 *
 * Polling, not websockets: the first load fetches the newest orders, then a
 * 5-second loop asks for everything changed since the last server timestamp —
 * so status edits from another device arrive the same way new orders do. A
 * failed poll doubles the wait up to 40 seconds and the header says
 * "Reconnecting" with the last successful sync, instead of looking live
 * while it is not.
 *
 * Status changes are optimistic: the card moves immediately, the PATCH carries
 * the `updatedAt` we last saw, and any failure rolls the card back and says
 * why. A 409 means another device changed it first — the board refreshes and
 * adopts the server's version rather than overwriting.
 */

import { useState } from "react";

import {
  nextOrderStatus,
  orderCode,
  orderStatusLabel,
  orderTotal,
  type Order,
  type OrderStatus,
} from "@/features/orders/schema";
import { GuidanceCard } from "@/components/ui/guidance-card";
import { Skeleton } from "@/components/ui/skeleton";
import { setOrderStatus } from "@/features/orders/client";
import { useOrderMonitor } from "@/features/orders/monitor";
import { SyncError } from "@/features/menus/sync";
import { formatTableLabel } from "@/features/orders/table-links";
import { formatPreviewPrice } from "@/features/menu/preview-utils";

const STATUS_STYLES: Record<OrderStatus, string> = {
  new: "bg-amber-100 text-amber-900",
  preparing: "bg-sky-100 text-sky-900",
  served: "bg-green-100 text-green-900",
  cancelled: "bg-stone-200 text-stone-600",
};

/**
 * Loading placeholder shared by both boards: pulsing ticket cards in the
 * shape the real ones land in, so the list does not jump when they arrive.
 */
export function OrdersSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading orders…</span>
      <ul className="space-y-3">
        {[0, 1, 2].map((row) => (
          <li key={row} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-3 h-3 w-2/5" />
            <Skeleton className="mt-2 h-3 w-1/3" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function errorMessage(error: unknown): string {
  if (error instanceof SyncError) {
    switch (error.code) {
      case "unauthorized":
        return "Your session expired — sign in again to keep the board live.";
      case "forbidden":
        return "You don't have access to this restaurant's orders.";
      case "not_found":
        return "That order no longer exists.";
      case "rate_limited":
        return error.message;
      default:
        return error.message;
    }
  }
  return "Could not reach the server. Check your connection.";
}

export function ServerOrdersBoard() {
  // The poller lives in the app-wide monitor (shared cursor with the tab
  // badge and toasts); the board only guards its own optimistic writes.
  const {
    orders,
    phase,
    connection,
    lastSyncedAt,
    pollError,
    soundOn,
    setSoundOn,
    hasArrived,
    notificationsAvailable,
    notificationPermission,
    requestNotifications,
    refresh,
    applyOptimistic,
    resolveOptimistic,
    revertOptimistic,
  } = useOrderMonitor();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function move(order: Order, target: OrderStatus) {
    if (busyId) return;
    setBusyId(order.id);
    setError(null);
    applyOptimistic(order.id, target);
    try {
      const updated = await setOrderStatus(order.id, target, order.updatedAt);
      resolveOptimistic(updated);
    } catch (updateError) {
      revertOptimistic(order);
      if (updateError instanceof SyncError && updateError.code === "conflict") {
        setError("That order changed elsewhere — showing the latest version.");
        refresh();
      } else {
        setError(errorMessage(updateError));
      }
    } finally {
      setBusyId(null);
    }
  }

  function cancel(order: Order) {
    if (!window.confirm(`Cancel order #${orderCode(order.id)} for ${formatTableLabel(order.tableLabel)}?`))
      return;
    void move(order, "cancelled");
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
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-600">
            {orders.length === 0
              ? "Orders placed from public table links appear here."
              : `${activeCount} active · ${openCount} new`}
            <ConnectionPill connection={connection} lastSyncedAt={lastSyncedAt} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundOn(!soundOn)}
            aria-pressed={soundOn}
            title={soundOn ? "New orders play a chime" : "Turn on a chime for new orders"}
            className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900"
          >
            {soundOn ? "🔔 Sound on" : "🔕 Sound off"}
          </button>
          <button
            type="button"
            onClick={() => refresh()}
            className="rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:border-amber-700 hover:text-amber-900"
          >
            Refresh
          </button>
        </div>
      </div>

      {notificationsAvailable && notificationPermission === "default" && hasArrived && (
        <button
          type="button"
          onClick={() => void requestNotifications()}
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 transition-colors hover:border-amber-500"
        >
          <span className="font-semibold">Notify me even when you&apos;re on another tab.</span>
          <span className="mt-0.5 block text-xs">
            Your browser will ask for permission — alerts work whether this tab is open or not.
          </span>
        </button>
      )}
      {notificationsAvailable && notificationPermission === "granted" && (
        <p className="text-xs text-stone-500">
          Browser notifications are on — new orders alert you even from another tab.
        </p>
      )}

      {(error ?? pollError) && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error ?? pollError}
        </p>
      )}

      {phase === "loading" && orders.length === 0 ? (
        <OrdersSkeleton />
      ) : orders.length === 0 && !error ? (
        <GuidanceCard
          title="No orders yet"
          steps={[
            "Print your table cards from the Tables tab.",
            "Scan one with a phone and place a real order — it shows up here within seconds.",
          ]}
          action={{ href: "/tables", label: "Go to Tables" }}
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => {
            const total = orderTotal(order.lines);
            const next = nextOrderStatus(order.status);
            const canAdvance = next !== order.status;
            return (
              <li
                key={order.id}
                className="rounded-2xl border border-stone-200 bg-white p-4"
                aria-busy={busyId === order.id}
              >
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
                      onClick={() => void move(order, next)}
                      className="rounded-full bg-amber-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-50"
                    >
                      Mark {orderStatusLabel(next).toLowerCase()}
                    </button>
                  )}
                  {order.status !== "cancelled" && order.status !== "served" && (
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => cancel(order)}
                      className="rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:border-red-700 hover:text-red-800 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ConnectionPill({
  connection,
  lastSyncedAt,
}: {
  connection: "idle" | "connecting" | "live" | "reconnecting";
  lastSyncedAt: string | null;
}) {
  const label =
    connection === "live"
      ? `Live · updated ${lastSyncedAt ? formatTime(lastSyncedAt) : "now"}`
      : connection === "reconnecting"
        ? `Reconnecting…${lastSyncedAt ? ` last update ${formatTime(lastSyncedAt)}` : ""}`
        : "Connecting…";
  const tone =
    connection === "live"
      ? "bg-emerald-50 text-emerald-800"
      : connection === "reconnecting"
        ? "bg-amber-100 text-amber-900"
        : "bg-stone-100 text-stone-600";
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          connection === "live"
            ? "bg-emerald-600"
            : connection === "reconnecting"
              ? "animate-pulse bg-amber-600"
              : "bg-stone-400"
        }`}
      />
      {label}
    </span>
  );
}
