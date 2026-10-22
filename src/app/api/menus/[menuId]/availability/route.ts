import { NextResponse } from "next/server";
import { z } from "zod";

import { menuAvailabilitySchema } from "@/features/availability/schema";
import {
  getRestaurantTimeZoneForMenu,
  setMenuAvailabilityForUser,
  TableRepoError,
} from "@/features/tables/repo";
import { getMenuForUser, MenuRepoError } from "@/features/menus/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET /api/menus/[menuId]/availability — the menu's opening windows
 *   (`{ availability: [] }` when unrestricted: always open) plus the
 *   restaurant's time zone, the zone the wall-clock times are written in
 *   (null = UTC).
 * PUT /api/menus/[menuId]/availability — replace the windows (owner-only).
 *   Body: `{ windows: [{ days, start, end }], timeZone? }`; a `timeZone`
 *   replaces the restaurant's zone after an IANA check, `null` clears it
 *   (UTC), and omitting it leaves the stored zone untouched.
 *
 * Reading is open to any member of the restaurant; writes are owner-only.
 * Menus of other tenants are 404, never 403. Error shape is the shared
 * `{ error: { code, message } }`.
 */

const putBodySchema = z.object({
  windows: menuAvailabilitySchema,
  timeZone: z.string().max(64).nullable().optional(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

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

type MenuParams = { params: Promise<{ menuId: string }> };

export async function GET(_request: Request, { params }: MenuParams) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { menuId } = await params;
  try {
    // Membership-scoped read: other tenants' menus are not_found, never leaked.
    const menu = await getMenuForUser(getDb(), userId, menuId);
    const timeZone = await getRestaurantTimeZoneForMenu(getDb(), menuId);
    return noStore(NextResponse.json({ availability: menu.availability, timeZone }));
  } catch (error) {
    if (error instanceof MenuRepoError) {
      if (error.code === "not_found") {
        return errorResponse("not_found", error.message, 404);
      }
      return errorResponse("forbidden", error.message, 403);
    }
    return errorResponse("server_db_unavailable", "Could not load opening times. Try again.", 503);
  }
}

export async function PUT(request: Request, { params }: MenuParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { menuId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const saved = await setMenuAvailabilityForUser(
      getDb(),
      userId,
      menuId,
      parsed.data.windows,
      parsed.data.timeZone
    );
    return noStore(NextResponse.json(saved));
  } catch (error) {
    if (error instanceof TableRepoError) {
      switch (error.code) {
        case "not_found":
          return errorResponse("not_found", error.message, 404);
        case "forbidden":
          return errorResponse("forbidden", error.message, 403);
        default:
          return errorResponse("invalid_body", error.message, 400);
      }
    }
    return errorResponse("server_db_unavailable", "Could not save opening times. Try again.", 503);
  }
}
