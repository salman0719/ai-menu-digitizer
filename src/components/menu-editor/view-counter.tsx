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

export function ViewCounter({ slug }: { slug: string }) {
  useEffect(() => {
    if (counted.has(slug)) return;
    counted.add(slug);
    void recordMenuView(slug);
  }, [slug]);

  return null;
}
