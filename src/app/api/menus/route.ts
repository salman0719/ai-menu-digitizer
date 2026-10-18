import { NextResponse } from "next/server";
import { z } from "zod";

import { createMenuForUser, listMenusForUser, MenuRepoError } from "@/features/menus/repo";
import { menuDocumentSchema } from "@/features/menu/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET  /api/menus — every menu across the restaurants the caller belongs to.
 * POST /api/menus — create one; body is `{ restaurantId, doc }` and the
 *   document's own `id` becomes the row id, so "Move my menus to my account"
 *   preserves local ids. 409 `menu_exists` when the id is already taken
 *   (the import path treats that as "already moved, skip").
 * Anonymous visitors get 401; a missing server DB gets 503 — the local-only
 * flow is unaffected. Error shape: { error: { code, message } }.
 */

const createBody = z.object({
  restaurantId: z.string().trim().min(1),
  doc: menuDocumentSchema,
});

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
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

function mapRepoError(error: MenuRepoError): NextResponse {
  switch (error.code) {
    case "stale":
      return errorResponse("stale_menu", error.message, 409, {
        currentUpdatedAt: error.currentUpdatedAt,
      });
    case "exists":
      return errorResponse("menu_exists", error.message, 409);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "invalid_doc":
      return errorResponse("invalid_body", error.message, 400);
    case "not_found":
    default:
      return errorResponse("not_found", error.message, 404);
  }
}

export async function GET() {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  try {
    const menus = await listMenusForUser(getDb(), userId);
    const response = NextResponse.json({ menus });
    // Personalized data must never be cached.
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return errorResponse("server_db_unavailable", "Could not load menus. Try again.", 503);
  }
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = createBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const menu = await createMenuForUser(
      getDb(),
      userId,
      parsed.data.restaurantId,
      parsed.data.doc
    );
    const response = NextResponse.json({ menu }, { status: 201 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not save the menu. Try again.", 503);
  }
}
