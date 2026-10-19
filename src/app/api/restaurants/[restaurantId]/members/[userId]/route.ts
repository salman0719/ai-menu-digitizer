import { NextResponse } from "next/server";
import { z } from "zod";

import {
  removeMemberForOwner,
  TenancyRepoError,
  updateMemberRoleForOwner,
} from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * PATCH  /api/restaurants/[restaurantId]/members/[userId] — owner changes a
 *   member's role (owner|staff).
 * DELETE /api/restaurants/[restaurantId]/members/[userId] — owner removes a
 *   member. Both refuse to leave the restaurant without an owner
 *   ("last_owner" 409). Non-members get 404 so ids stay unprobeable.
 * Error shape: { error: { code, message } }.
 */

const roleBody = z.object({
  role: z.enum(["owner", "staff"]),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapRepoError(error: TenancyRepoError): NextResponse {
  switch (error.code) {
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "last_owner":
      return errorResponse("last_owner", error.message, 409);
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string; userId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId, userId: memberUserId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = roleBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const member = await updateMemberRoleForOwner(
      getDb(),
      userId,
      restaurantId,
      memberUserId,
      parsed.data.role
    );
    const response = NextResponse.json({ member });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof TenancyRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not change the role. Try again.", 503);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string; userId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId, userId: memberUserId } = await params;

  try {
    await removeMemberForOwner(getDb(), userId, restaurantId, memberUserId);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TenancyRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not remove the member. Try again.", 503);
  }
}
