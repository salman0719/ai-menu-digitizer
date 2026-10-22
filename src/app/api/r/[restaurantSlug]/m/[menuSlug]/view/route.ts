import { NextResponse } from "next/server";

import { recordPublishedMenuView } from "@/features/publishing/repo";
import { getDb } from "@/lib/db";

/**
 * POST /api/r/[restaurantSlug]/m/[menuSlug]/view — count one visit to a
 * published menu page.
 *
 * Cookie-free by design (PHASE-2.md §6): no identifier is stored, so a count
 * is just an increment. The page is public, so this needs no session; it only
 * touches the database through the scoped increment, and it answers 404 when
 * the address is unknown or unpublished so nothing is counted for dead links.
 * The path mirrors the page's own address, so the count can never be applied
 * to a different café's menu that happens to share a slug.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ restaurantSlug: string; menuSlug: string }> }
) {
  const { restaurantSlug, menuSlug } = await params;
  try {
    const counted = await recordPublishedMenuView(getDb(), restaurantSlug, menuSlug);
    return new NextResponse(null, {
      status: counted ? 204 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // A view count is never worth breaking the page over; the client beacon
    // ignores failures too.
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
}
