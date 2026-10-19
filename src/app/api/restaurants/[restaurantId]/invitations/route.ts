import { NextResponse } from "next/server";

import { InvitationError, listPendingInvitationsForOwner } from "@/features/tenancy/invitations";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * GET /api/restaurants/[restaurantId]/invitations — still-open invitations
 * (owner only). Pending rows show the address, role and expiry so the team
 * panel can offer resend and revoke; accepted and expired links are not
 * listed. Non-members get 404 so ids stay unprobeable.
 * Error shape: { error: { code, message } }.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapInvitationError(error: InvitationError): NextResponse {
  switch (error.code) {
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

/** Session guard. */
async function requireUser(): Promise<string | NextResponse> {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return errorResponse("unauthorized", "Sign in to continue.", 401);
    }
    return userId;
  } catch {
    return errorResponse(
      "server_db_unavailable",
      "Server sync is not available yet — keep working locally.",
      503
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;
  try {
    const invitations = await listPendingInvitationsForOwner(getDb(), userId, restaurantId);
    const response = NextResponse.json({ invitations });
    // Personalized data must never be cached.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof InvitationError) return mapInvitationError(error);
    return errorResponse("server_db_unavailable", "Could not load invitations. Try again.", 503);
  }
}
