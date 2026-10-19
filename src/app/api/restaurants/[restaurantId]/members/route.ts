import { NextResponse } from "next/server";
import { z } from "zod";

import {
  addMemberForOwner,
  listMembersForUser,
  TenancyRepoError,
} from "@/features/tenancy/repo";
import {
  createInvitationForOwner,
  InvitationError,
} from "@/features/tenancy/invitations";
import { sendInvitationEmail } from "@/lib/auth/email";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET  /api/restaurants/[restaurantId]/members — the team list (any member).
 * POST /api/restaurants/[restaurantId]/members — owner adds a teammate by
 *   email with role owner|staff. An existing account joins immediately;
 *   otherwise a one-time invitation is created and emailed (magic-link
 *   acceptance, 7-day expiry). The response says which happened:
 *   { member } or { invitation }.
 * Non-members get 404 so restaurant ids stay unprobeable across accounts.
 * Error shape: { error: { code, message } }.
 */

const addBody = z.object({
  email: z.email("Enter an email address.").max(254),
  role: z.enum(["owner", "staff"]),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapRepoError(error: TenancyRepoError): NextResponse {
  switch (error.code) {
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "user_not_found":
      return errorResponse("user_not_found", error.message, 404);
    case "already_member":
      return errorResponse("already_member", error.message, 409);
    case "last_owner":
      return errorResponse("last_owner", error.message, 409);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

function mapInvitationError(error: InvitationError): NextResponse {
  switch (error.code) {
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "already_member":
      return errorResponse("already_member", error.message, 409);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

/** Session guard shared by both handlers. */
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
    const members = await listMembersForUser(getDb(), userId, restaurantId);
    const response = NextResponse.json({ members });
    // Personalized data must never be cached.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof TenancyRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not load members. Try again.", 503);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = addBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const member = await addMemberForOwner(
      getDb(),
      userId,
      restaurantId,
      parsed.data.email,
      parsed.data.role
    );
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    if (error instanceof TenancyRepoError && error.code !== "user_not_found") {
      return mapRepoError(error);
    }
    if (error instanceof TenancyRepoError) {
      // No account uses that address yet: invite them instead of failing.
      return inviteTeammate(request, userId, restaurantId, parsed.data.email, parsed.data.role);
    }
    return errorResponse("server_db_unavailable", "Could not add the member. Try again.", 503);
  }
}

/** Create a pending invitation and email its one-time accept link. */
async function inviteTeammate(
  request: Request,
  userId: string,
  restaurantId: string,
  email: string,
  role: "owner" | "staff"
): Promise<NextResponse> {
  try {
    const created = await createInvitationForOwner(getDb(), userId, restaurantId, email, role);
    const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    try {
      await sendInvitationEmail({
        email: created.invitation.email,
        restaurantName: created.restaurantName,
        inviterName: created.inviterName,
        role: created.invitation.role,
        url: `${baseUrl}/invitations/${encodeURIComponent(created.token)}`,
      });
    } catch {
      return errorResponse(
        "email_failed",
        "The invitation could not be emailed. Check the address and try again.",
        502
      );
    }
    return NextResponse.json({ invitation: created.invitation }, { status: 201 });
  } catch (error) {
    if (error instanceof InvitationError) return mapInvitationError(error);
    return errorResponse("server_db_unavailable", "Could not create the invitation. Try again.", 503);
  }
}
