import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { acceptInvitation, getInvitationByToken, InvitationError } from "@/features/tenancy/invitations";
import { user } from "@/lib/db/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET  /api/invitations/[token] — what the invitation is for (public: the
 *   token holder must be able to see it before signing in). Never includes
 *   token material or account ids.
 * POST /api/invitations/[token] — accept it. Requires a session, and the
 *   signed-in account's email must match the invitation; owning the link is
 *   not enough to join as someone else.
 * Expiry and reuse are refused here ("invitation_expired" 410,
 * "invitation_used" 409) so the UI can explain them.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapInvitationError(error: InvitationError): NextResponse {
  switch (error.code) {
    case "expired":
      return errorResponse("invitation_expired", error.message, 410);
    case "used":
      return errorResponse("invitation_used", error.message, 409);
    case "wrong_account":
      return errorResponse("wrong_account", error.message, 403);
    case "already_member":
      return errorResponse("already_member", error.message, 409);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const invitation = await getInvitationByToken(getDb(), token);
    if (!invitation) {
      return errorResponse("not_found", "That invitation does not exist.", 404);
    }
    const response = NextResponse.json({
      invitation: {
        restaurantName: invitation.restaurantName,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        status: invitation.status,
      },
    });
    // Invitation state is per-token and must never be cached.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorResponse("server_db_unavailable", "Could not load the invitation. Try again.", 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const { token } = await params;
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
  if (!userId) {
    return errorResponse("unauthorized", "Sign in to accept the invitation.", 401);
  }

  try {
    const db = getDb();
    // The address comes from the account row, never from the request body.
    const accounts = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const account = accounts[0];
    if (!account) {
      return errorResponse("unauthorized", "Sign in to accept the invitation.", 401);
    }

    const accepted = await acceptInvitation(db, {
      token,
      userId,
      email: account.email,
    });
    const response = NextResponse.json({
      restaurant: {
        id: accepted.restaurantId,
        name: accepted.restaurantName,
        role: accepted.role,
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof InvitationError) return mapInvitationError(error);
    return errorResponse("server_db_unavailable", "Could not accept the invitation. Try again.", 503);
  }
}
