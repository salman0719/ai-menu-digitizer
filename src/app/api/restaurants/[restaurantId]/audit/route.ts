import { NextResponse } from "next/server";

import { listAuditEventsForUser } from "@/features/tenancy/audit";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * GET /api/restaurants/[restaurantId]/audit — recent team activity (any
 * member of the restaurant). Rows carry snapshotted actor/target names so
 * the panel still reads correctly after a teammate is removed. Non-members
 * get 404 so restaurant ids stay unprobeable across accounts.
 * Error shape: { error: { code, message } }.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
  if (!userId) return errorResponse("unauthorized", "Sign in to continue.", 401);

  const { restaurantId } = await params;
  try {
    const events = await listAuditEventsForUser(getDb(), userId, restaurantId);
    if (!events) return errorResponse("not_found", "That restaurant does not exist.", 404);
    const response = NextResponse.json({ events });
    // Personalized data must never be cached.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorResponse("server_db_unavailable", "Could not load team activity. Try again.", 503);
  }
}
