import { NextResponse } from "next/server";

import { PublicationRepoError } from "@/features/publishing/repo";
import { publishMenuWithSetupForUser } from "@/features/publishing/setup";
import { publishSetupBodySchema } from "@/features/publishing/setup-schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * POST /api/menus/[menuId]/publish-setup — the publish wizard's one submit.
 *
 * Body: `{ doc?, restaurantId?, restaurantName?, theme, layout, slug? }`.
 * The server creates a restaurant only when the caller owns none, copies a
 * browser-only draft into that restaurant, and publishes it. Existing
 * account menus are published from their stored revision (the local copy is
 * never allowed to overwrite the account). Repeating the same request is
 * safe: a partial failure is finished by the retry, not duplicated.
 *
 * Owner-only; other tenants are 404, staff are 403. Error shape is the
 * shared `{ error: { code, message } }`.
 */

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
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
      return errorResponse("not_published", error.message, 409);
    default:
      return errorResponse("server_db_unavailable", "Could not publish. Try again.", 503);
  }
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
  const parsed = publishSetupBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const result = await publishMenuWithSetupForUser(getDb(), userId, menuId, parsed.data);
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PublicationRepoError) return mapRepoError(error);
    return errorResponse(
      "server_db_unavailable",
      "Could not publish this menu. Your draft is still safe in this browser.",
      503
    );
  }
}
