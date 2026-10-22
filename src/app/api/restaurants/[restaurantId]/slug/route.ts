import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureRestaurantSlugForUser,
  setRestaurantSlugForUser,
  TableRepoError,
} from "@/features/tables/repo";
import { getRestaurantForUser, TenancyRepoError } from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET /api/restaurants/[restaurantId]/slug — the restaurant's public
 *   `/r/<slug>` address (`{ restaurant: { id, name, slug } }`, slug null
 *   until claimed). Any member may read it.
 * PUT /api/restaurants/[restaurantId]/slug — owner-only. Body is either
 *   `{ slug }` to set an explicit address or `{ ensure: true }` to claim
 *   the first free address derived from the restaurant's name.
 *
 * Other tenants' restaurants are 404, never 403. Error shape is the shared
 * `{ error: { code, message } }`.
 */

const putBodySchema = z.union([
  z.object({ slug: z.string().trim().min(1).max(64) }),
  z.object({ ensure: z.literal(true) }),
]);

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

function mapTableError(error: TableRepoError): NextResponse {
  switch (error.code) {
    case "not_found":
      return errorResponse("not_found", error.message, 404);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "slug_taken":
      return errorResponse("slug_taken", error.message, 409);
    default:
      return errorResponse("invalid_body", error.message, 400);
  }
}

type RestaurantParams = { params: Promise<{ restaurantId: string }> };

export async function GET(_request: Request, { params }: RestaurantParams) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;
  try {
    const restaurant = await getRestaurantForUser(getDb(), userId, restaurantId);
    if (!restaurant) {
      return errorResponse("not_found", "That restaurant does not exist.", 404);
    }
    return noStore(
      NextResponse.json({
        restaurant: { id: restaurant.id, name: restaurant.name, slug: restaurant.slug },
      })
    );
  } catch (error) {
    if (error instanceof TenancyRepoError) {
      return errorResponse("not_found", error.message, 404);
    }
    return errorResponse("server_db_unavailable", "Could not load the restaurant link. Try again.", 503);
  }
}

export async function PUT(request: Request, { params }: RestaurantParams) {
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
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const restaurant =
      "ensure" in parsed.data
        ? await ensureRestaurantSlugForUser(getDb(), userId, restaurantId)
        : await setRestaurantSlugForUser(getDb(), userId, restaurantId, parsed.data.slug);
    return noStore(NextResponse.json({ restaurant }));
  } catch (error) {
    if (error instanceof TableRepoError) return mapTableError(error);
    return errorResponse("server_db_unavailable", "Could not save the restaurant link. Try again.", 503);
  }
}
