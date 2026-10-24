"use client";

import { useEffect, useState } from "react";

import { TableQrPanel } from "@/components/tables/table-qr-panel";
import { GuidanceCard } from "@/components/ui/guidance-card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchRestaurants, type RestaurantOption } from "@/features/tenancy/client";
import { selectedRestaurant, showRestaurantPicker } from "@/features/tenancy/picker";

/**
 * Restaurant-level table cards.
 *
 * A table code encodes the restaurant link (`/r/<slug>/t/<label>`), so the
 * cards belong to the restaurant, not to whichever menu was open when they
 * were printed. The panel therefore lives here, next to Orders: every member
 * (owner or staff) can print, while only an owner sees the claim action.
 */
export function RestaurantTables({
  signedIn,
  sessionPending = false,
}: {
  signedIn: boolean;
  /** Session still resolving: show the loading shape, never the sign-in card. */
  sessionPending?: boolean;
}) {
  const [restaurants, setRestaurants] = useState<RestaurantOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRestaurants();
        if (cancelled) return;
        setRestaurants(list);
        // One restaurant means no choice to make: open it straight away.
        if (list.length === 1 && list[0]) setSelectedId(list[0].id);
      } catch {
        if (!cancelled) {
          setLoadError("Could not load your restaurants. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const selected = selectedRestaurant(restaurants, selectedId);

  return (
    <div className="flex flex-col gap-4">
      <div data-print-hide>
        <h2 className="text-xl font-bold text-stone-900">Table QR codes</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-stone-600">
          One code per table, for the whole restaurant. Each card opens that table&apos;s page with
          every menu that is open right now — so adding a lunch menu, republishing, or renaming a
          menu never makes a printed card out of date.
        </p>
      </div>

      {!signedIn && !sessionPending && (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-medium text-stone-900">Sign in to print table cards</p>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            Table cards point at your restaurant link, which lives in your account.
          </p>
          <a
            href="/sign-in"
            className="mt-3 inline-block rounded-full bg-amber-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            Sign in
          </a>
        </div>
      )}

      {signedIn && loadError && <p className="text-xs text-red-700">{loadError}</p>}

      {(sessionPending || signedIn) && restaurants === null && !loadError && (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">Loading your restaurants…</span>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-9 w-full max-w-sm" />
            <Skeleton className="mt-3 h-3 w-3/5" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} className="aspect-square w-full rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {signedIn && restaurants !== null && restaurants.length === 0 && (
        <GuidanceCard
          title="No restaurant yet"
          steps={[
            "Add a menu to your account from My menus — adding it creates the restaurant.",
            "Come back here to print one card per table.",
          ]}
          action={{ href: "/menus", label: "Go to My menus" }}
        />
      )}

      {signedIn && showRestaurantPicker(restaurants) && restaurants !== null && (
        <div data-print-hide className="rounded-2xl border border-stone-200 bg-white p-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
            Restaurant
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="max-w-sm rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <option value="" disabled>
                Choose a restaurant…
              </option>
              {restaurants.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                  {restaurant.role === "staff" ? " (staff)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs leading-5 text-stone-500">
            Cards stay attached to this restaurant. Staff can print them; only an owner can claim or
            change the restaurant link.
          </p>
        </div>
      )}

      {signedIn && selected && (
        <TableQrPanel
          key={selected.id}
          context="restaurant"
          restaurantId={selected.id}
          restaurantName={selected.name}
          isOwner={selected.role === "owner"}
        />
      )}
    </div>
  );
}
