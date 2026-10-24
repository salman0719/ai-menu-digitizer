import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getOrderAlertPrefs,
  updateOrderAlertPrefsForOwner,
} from "@/features/orders/alerts";
import { getRestaurantForUser } from "@/features/tenancy/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/**
 * GET|PUT /api/restaurants/[restaurantId]/alerts — new-order email
 * preference (R0.4). Any member may read; only an owner may write.
 * Anonymous visitors get 401, staff writers get 403, and outsiders get
 * 404 so ids cannot be probed across tenants. Error shape:
 * { error: { code, message } }.
 */

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const alertsBody = z.object({
  enabled: z.boolean(),
  /** Blank clears the override back to the owners' account emails. */
  email: z
    .string()
    .trim()
    .max(254, "That address is too long.")
    .refine((value) => value === "" || emailPattern.test(value), {
      message: "Enter a valid email address, or leave it blank.",
    }),
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

type RouteParams = { params: Promise<{ restaurantId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;
  const { restaurantId } = await params;

  try {
    const prefs = await getOrderAlertPrefs(getDb(), userId, restaurantId);
    if (!prefs) {
      return refusalResponse(userId, restaurantId, "Only members can see these settings.");
    }
    return noStore(NextResponse.json({ alerts: prefs }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not load the alert settings.", 503);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
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
  const parsed = alertsBody.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }
  const rawEmail = parsed.data.email.trim().toLowerCase();
  const email = rawEmail === "" ? null : rawEmail;

  try {
    const prefs = await updateOrderAlertPrefsForOwner(getDb(), userId, restaurantId, {
      enabled: parsed.data.enabled,
      email,
    });
    if (!prefs) {
      return refusalResponse(userId, restaurantId, "Only an owner can change these settings.");
    }
    return noStore(NextResponse.json({ alerts: prefs }));
  } catch {
    return errorResponse("server_db_unavailable", "Could not save the alert settings.", 503);
  }
}
