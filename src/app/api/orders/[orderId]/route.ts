import { NextResponse } from "next/server";
import { z } from "zod";

import { OrderRepoError, updateOrderStatusForStaff } from "@/features/orders/repo";
import { ORDER_STATUSES } from "@/features/orders/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

/**
 * PATCH /api/orders/[orderId] — move an order's status (owner or staff).
 *
 * Body: `{ status, expectedUpdatedAt? }`. When the caller sends the
 * `updatedAt` it last saw, the write is conditional: if another device
 * changed the order first, the response is 409 `order_stale` with the current
 * order, and the board refreshes instead of silently overwriting. Statuses
 * only move forward (see `canTransitionOrderStatus`).
 */

const bodySchema = z.object({
  status: z.enum(ORDER_STATUSES),
  expectedUpdatedAt: z.string().min(1).optional(),
});

function errorResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

function mapRepoError(error: OrderRepoError): NextResponse {
  switch (error.code) {
    case "not_found":
      return errorResponse("not_found", error.message, 404);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "stale":
      return errorResponse("order_stale", error.message, 409, { order: error.current });
    case "invalid":
    default:
      return errorResponse("invalid_body", error.message, 400);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
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
  if (!userId) return errorResponse("unauthorized", "Sign in to continue.", 401);

  const { orderId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }

  try {
    const order = await updateOrderStatusForStaff(
      getDb(),
      userId,
      orderId,
      parsed.data.status,
      parsed.data.expectedUpdatedAt ?? null
    );
    const response = NextResponse.json({ order });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) return mapRepoError(error);
    return errorResponse("server_db_unavailable", "Could not update the order. Try again.", 503);
  }
}
