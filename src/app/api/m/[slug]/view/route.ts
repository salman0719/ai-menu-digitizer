import { NextResponse } from "next/server";

import { recordPublishedView } from "@/features/publishing/repo";
import { getDb } from "@/lib/db";

/**
 * POST /api/m/[slug]/view — count one visit to a published menu page.
 *
 * Cookie-free by design (PHASE-2.md §6): no identifier is stored, so a count
 * is just an increment. The page is public, so this needs no session; it only
 * touches the database through the atomic increment, and it answers 404 when
 * the slug is unknown or unpublished so nothing is counted for dead links.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const counted = await recordPublishedView(getDb(), slug);
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
