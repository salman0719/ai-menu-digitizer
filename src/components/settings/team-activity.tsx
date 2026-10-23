"use client";

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { describeAuditEvent } from "@/features/tenancy/audit-format";
import { fetchAuditEvents, type AuditEventOption } from "@/features/tenancy/client";

/**
 * Recent team activity: who invited, changed or removed whom. Read-only and
 * optional chrome — if loading fails the rest of the team panel still works,
 * and the server remains the source of truth for permissions.
 */
export function TeamActivity({
  restaurantId,
  refreshKey,
}: {
  restaurantId: string;
  /** Bumped by the team panel after a successful change, to reload. */
  refreshKey: number;
}) {
  const [events, setEvents] = useState<AuditEventOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchAuditEvents(restaurantId);
        if (cancelled) return;
        setEvents(list);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, refreshKey]);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="text-sm font-bold tracking-tight text-stone-900">Team activity</h3>
      <p className="mt-1 text-xs leading-5 text-stone-500">
        Who invited, changed roles for, or removed someone — most recent first.
      </p>

      {failed && (
        <p className="mt-3 text-xs text-stone-500">
          Could not load team activity. The changes themselves still applied.
        </p>
      )}

      {!failed && events === null && (
        <div role="status" aria-busy="true" className="mt-3 flex flex-col gap-2">
          <span className="sr-only">Loading team activity…</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-baseline justify-between gap-3 border-b border-stone-100 pb-2 last:border-b-0 last:pb-0"
            >
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          ))}
        </div>
      )}

      {!failed && events !== null && events.length === 0 && (
        <p className="mt-3 text-xs text-stone-500">
          No team changes yet. Invitations, role changes and removals will appear here.
        </p>
      )}

      {!failed && events !== null && events.length > 0 && (
        <ul className="mt-3 space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-stone-100 pb-2 last:border-b-0 last:pb-0"
            >
              <p className="min-w-0 flex-1 text-xs leading-5 text-stone-700">
                {describeAuditEvent(event)}
              </p>
              <time
                dateTime={event.createdAt}
                className="text-[11px] text-stone-400"
                title={new Date(event.createdAt).toLocaleString()}
              >
                {formatWhen(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Short relative time ("3 min ago"); falls back to the date. */
function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}
