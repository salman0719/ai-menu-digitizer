"use client";

/**
 * R0 order monitor toasts: one tap target per new order, above the phone tab
 * bar and clear of the desktop content. Tapping opens the Orders tab (which
 * counts as seeing them); the × dismisses without navigating.
 */

import { orderCode, type Order } from "@/features/orders/schema";
import { formatTableLabel } from "@/features/orders/table-links";

export interface MonitorToastItem {
  id: string;
  order: Order;
}

export function MonitorToasts({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: MonitorToastItem[];
  onOpen: () => void;
  onDismiss: (toastId: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      data-print-hide
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex w-full max-w-sm flex-col gap-2 px-4 sm:bottom-8"
    >
      {toasts.map(({ id, order }) => (
        <div
          key={id}
          role="alert"
          className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-stone-900 py-3 pr-2 pl-4 text-white shadow-xl"
        >
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            <p className="text-sm font-bold">
              🔔 New order · {formatTableLabel(order.tableLabel)}{" "}
              <span className="font-medium text-amber-300">#{orderCode(order.id)}</span>
            </p>
            <p className="truncate text-xs text-stone-300">
              {order.lines
                .slice(0, 2)
                .map((line) => `${line.quantity}× ${line.name}`)
                .join(", ")}
              {order.lines.length > 2 ? ` +${order.lines.length - 2} more` : ""}
            </p>
          </button>
          <button
            type="button"
            onClick={() => onDismiss(id)}
            aria-label="Dismiss"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-lg text-stone-300 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
