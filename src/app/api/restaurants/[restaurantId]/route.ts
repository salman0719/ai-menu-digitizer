import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteRestaurantForOwner,
  getRestaurantForUser,
  renameRestaurantForOwner,
} from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * PATCH  /api/restaurants/[restaurantId] — owner-only rename.
 * DELETE /api/restaurants/[restaurantId] — owner-only delete. Memberships,
 *   menus, published pages and orders cascade in the database, so the UI
 *   must warn about that before calling.
 * Anonymous visitors get 401; members without the owner role get 403;
 * everyone else gets 404 so ids cannot be probed across accounts (same
 * rule as /api/menus/[menuId]). Error shape: { error: { code, message } }.
 */

const renameBody = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
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

/**
 * Why an owner-only mutation refused: staff (and other members) get 403,
 * while outsiders get 404 — a foreign id must not be distinguishable from
 * a missing one.
 */
async function refusalResponse(
  userId: string,
  restaurantId: string,
  memberMessage: string
): Promise<NextResponse> {
  const member = await getRestaurantForUser(getDb(), userId, restaurantId);
  return member
    ? errorResponse("forbidden", memberMessage, 403)
    : errorResponse("not_found", "That restaurant does not exist.", 404);
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function PATCH(
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
  const parsed = renameBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const restaurant = await renameRestaurantForOwner(
      getDb(),
      userId,
      restaurantId,
      parsed.data.name
    );
    if (!restaurant) {
      return refusalResponse(userId, restaurantId, "Only an owner can rename this restaurant.");
    }
    return noStore(NextResponse.json({ restaurant }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not rename the restaurant. Try again.", 503);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  try {
    const deleted = await deleteRestaurantForOwner(getDb(), userId, restaurantId);
    if (!deleted) {
      return refusalResponse(userId, restaurantId, "Only an owner can delete this restaurant.");
    }
    return noStore(new NextResponse(null, { status: 204 }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not delete the restaurant. Try again.", 503);
  }
}
