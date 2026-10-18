import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteMenuForUser,
  getMenuForUser,
  MenuRepoError,
  updateMenuForUser,
} from "@/features/menus/repo";
import { menuDocumentSchema } from "@/features/menu/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET    /api/menus/[menuId] — one menu (any member of its restaurant).
 * PUT    /api/menus/[menuId] — replace the document, but only when it has
 *   not changed on the server since the caller read it. The body carries
 *   `{ doc, expectedUpdatedAt }`; a stale `expectedUpdatedAt` gets
 *   409 `stale_menu` with the current server `updatedAt`, so two editing
 *   browsers converge through an explicit reload instead of overwriting
 *   each other (PHASE-2.md §4 P2-3).
 * DELETE /api/menus/[menuId] — owner-only delete.
 * Errors use the { error: { code, message } } shape; 404 is returned for
 * menus of other tenants so ids cannot be probed across accounts.
 */

const updateBody = z.object({
  doc: menuDocumentSchema,
  expectedUpdatedAt: z.string().min(1),
});

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
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

export async function GET(_request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { menuId } = await params;
  try {
    const menu = await getMenuForUser(getDb(), userId, menuId);
    const response = NextResponse.json({ menu });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not load the menu. Try again.", 503);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
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
  const parsed = updateBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }
  if (parsed.data.doc.id !== menuId) {
    return errorResponse("invalid_body", "The document id must match the menu id.", 400);
  }

  try {
    const menu = await updateMenuForUser(
      getDb(),
      userId,
      menuId,
      parsed.data.doc,
      parsed.data.expectedUpdatedAt
    );
    const response = NextResponse.json({ menu });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not save the menu. Try again.", 503);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ menuId: string }> }
) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { menuId } = await params;
  try {
    const deleted = await deleteMenuForUser(getDb(), userId, menuId);
    if (!deleted) return errorResponse("not_found", "That menu does not exist.", 404);
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MenuRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not delete the menu. Try again.", 503);
  }
}
