import { NextResponse } from "next/server";

import {
  InvitationError,
  resendInvitationForOwner,
  revokeInvitationForOwner,
} from "@/features/tenancy/invitations";
import { emailInvitation, publicBaseUrl } from "@/features/tenancy/invite-mailer";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST   /api/restaurants/[restaurantId]/invitations/[invitationId] — owner
 *   re-sends an invitation: a fresh token replaces the old link and the email
 *   goes out again. The response carries only the invitation summary.
 * DELETE /api/restaurants/[restaurantId]/invitations/[invitationId] — owner
 *   revokes it; the emailed link stops working immediately.
 * Unknown ids, accepted invitations and non-members all resolve to 404.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string; invitationId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId, invitationId } = await params;

  try {
    const created = await resendInvitationForOwner(getDb(), userId, restaurantId, invitationId);
    try {
      await emailInvitation(created, publicBaseUrl(request));
    } catch {
      return errorResponse(
        "email_failed",
        "The invitation could not be emailed. Check the address and try again.",
        502
      );
    }
    const response = NextResponse.json({ invitation: created.invitation });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof InvitationError) return mapInvitationError(error);
    return errorResponse("server_db_unavailable", "Could not resend the invitation. Try again.", 503);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string; invitationId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId, invitationId } = await params;

  try {
    await revokeInvitationForOwner(getDb(), userId, restaurantId, invitationId);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvitationError) return mapInvitationError(error);
    return errorResponse("server_db_unavailable", "Could not revoke the invitation. Try again.", 503);
  }
}
