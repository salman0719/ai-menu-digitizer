"use client";

import { useEffect } from "react";

import { recordMenuView } from "@/features/publishing/client";

/**
 * Counts one visit to a published menu page. Renders nothing and never blocks
 * the page: the beacon is a fire-and-forget POST, cookie-free, with no
 * identifier of any kind (PHASE-2.md §6). A module-level set de-duplicates
 * React's development double-effect, so one page load is one view.
 */
const counted = new Set<string>();

export function ViewCounter({ restaurantSlug, slug }: { restaurantSlug: string; slug: string }) {
  useEffect(() => {
    const key = `${restaurantSlug}/${slug}`;
    if (counted.has(key)) return;
    counted.add(key);
    void recordMenuView(restaurantSlug, slug);
  }, [restaurantSlug, slug]);

  return null;
}
