import { NextResponse } from "next/server";

import {
  changeMenuSlugForUser,
  getPublicationStatus,
  publishMenuForUser,
  PublicationRepoError,
  unpublishMenuForUser,
} from "@/features/publishing/repo";
import { changeSlugBodySchema, publishBodySchema } from "@/features/publishing/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET    /api/menus/[menuId]/publication — the menu's public-link state
 *   (`{ publication: null }` when it was never published).
 * POST   /api/menus/[menuId]/publication — publish the current document, or
 *   publish changes: stores a revision snapshot and points the live page at
 *   it. Body: `{ theme, layout, slug? }`. Optional `slug` names the link on
 *   first publish (409 `slug_taken` if used) or renames it afterwards.
 * PATCH  /api/menus/[menuId]/publication — change only the address.
 * DELETE /api/menus/[menuId]/publication — stop serving; the slug stays
 *   reserved for this menu (republishing reuses it).
 *
 * Reading is open to any member of the restaurant; every mutation is
 * owner-only. Menus of other tenants are 404, never 403. Error shape is the
 * shared `{ error: { code, message } }`.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
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

function mapRepoError(error: PublicationRepoError): NextResponse {
  switch (error.code) {
    case "not_found":
      return errorResponse("not_found", error.message, 404);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "invalid":
      return errorResponse("invalid_body", error.message, 400);
    case "slug_taken":
      return errorResponse("slug_taken", error.message, 409);
    case "not_published":
    default:
      return errorResponse("not_published", error.message, 409);
  }
}

type MenuParams = { params: Promise<{ menuId: string }> };

export async function GET(_request: Request, { params }: MenuParams) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { menuId } = await params;
  try {
    const publication = await getPublicationStatus(getDb(), userId, menuId);
    const response = NextResponse.json({ publication });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PublicationRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not load the link status. Try again.", 503);
  }
}

export async function POST(request: Request, { params }: MenuParams) {
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
  const parsed = publishBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const publication = await publishMenuForUser(getDb(), userId, menuId, parsed.data);
    const response = NextResponse.json({ publication });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PublicationRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not publish. Try again.", 503);
  }
}

export async function PATCH(request: Request, { params }: MenuParams) {
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
  const parsed = changeSlugBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const publication = await changeMenuSlugForUser(getDb(), userId, menuId, parsed.data.slug);
    const response = NextResponse.json({ publication });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PublicationRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not change the link. Try again.", 503);
  }
}

export async function DELETE(request: Request, { params }: MenuParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { menuId } = await params;
  try {
    const publication = await unpublishMenuForUser(getDb(), userId, menuId);
    const response = NextResponse.json({ publication });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PublicationRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not unpublish. Try again.", 503);
  }
}
