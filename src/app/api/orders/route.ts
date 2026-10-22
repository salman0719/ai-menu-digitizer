import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  consumeOrderRateLimit,
  listOrdersForStaff,
  OrderRepoError,
  placeOrderFromSlug,
  placeTableOrder,
} from "@/features/orders/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { alertOps, reportError } from "@/lib/observability/alerts";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * POST /api/orders — place an order from a public table link. Anonymous by
 * design: no session, no cookie, nothing about the diner stored.
 *
 * The body carries item ids, variants, and quantities only. Names, prices,
 * and the total are resolved server-side from the published snapshot (the
 * menu the diner actually saw). Guards on this untrusted endpoint:
 * - payload caps (header size, 30 lines, 20 per line, 280-char note),
 * - a honeypot field humans never fill,
 * - a fixed-window rate limit per hashed caller+minute, stored in the DB so
 *   serverless instances share it, answering 429 `rate_limited`.
 *
 * GET /api/orders — staff board query (session required). Reads orders across
 * the caller's restaurants, optionally one via `restaurantId`, and returns
 * everything changed after `since` so status edits propagate as well as new
 * orders. Personalised data is never cached.
 */

const MAX_BODY_BYTES = 8 * 1024;

const orderLineBodySchema = z.object({
  menuItemId: z.string().min(1).max(64),
  variantName: z.string().min(1).max(48).nullable().optional(),
  quantity: z.number().int().min(1).max(20),
  /** Which menu this line comes from — required on the table path. */
  menuSlug: z.string().trim().min(1).max(64).nullable().optional(),
});

const orderBodySchema = z
  .object({
    /** Single-menu path: the menu's own address segment. Omit on the table path. */
    slug: z.string().trim().min(1).max(64).nullable().optional(),
    /**
     * The café's public slug. Required on both paths: alongside `slug` on
     * the single-menu path (`/r/<slug>/m/<menu>/order`), and on its own on
     * the table path (`/r/<slug>/t/<table>`, where every line names its menu).
     */
    restaurantSlug: z.string().trim().min(1).max(64).nullable().optional(),
    tableLabel: z.string().trim().min(1).max(24),
    note: z.string().max(280).nullable().optional(),
    lines: z.array(orderLineBodySchema).min(1).max(30),
    /** Honeypot: rendered off-screen, so only a script fills it. */
    website: z.string().max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.restaurantSlug) {
      ctx.addIssue({ code: "custom", message: "A menu or restaurant link is required." });
    } else if (data.slug && data.lines.some((line) => line.menuSlug)) {
      ctx.addIssue({ code: "custom", message: "Lines cannot name a menu on this link." });
    } else if (!data.slug && data.lines.some((line) => !line.menuSlug)) {
      ctx.addIssue({ code: "custom", message: "Every line needs its menu." });
    }
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
    case "menu_not_live":
      return errorResponse("menu_not_live", error.message, 404);
    case "unknown_item":
    case "item_unavailable":
      return errorResponse(error.code, error.message, 409);
    case "rate_limited":
      return errorResponse("rate_limited", error.message, 429);
    case "stale":
      return errorResponse("order_stale", error.message, 409, { order: error.current });
    case "not_found":
      return errorResponse("not_found", error.message, 404);
    case "forbidden":
      return errorResponse("forbidden", error.message, 403);
    case "invalid":
    default:
      return errorResponse("invalid_body", error.message, 400);
  }
}

/**
 * One-way bucket id for the rate limiter: the caller's address is hashed with
 * the current minute, so no raw IP is stored and every window starts fresh.
 */
function callerBucket(request: Request, now: Date): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const digest = createHash("sha256").update(address).digest("hex").slice(0, 24);
  return `order:${Math.floor(now.getTime() / 60_000)}:${digest}`;
}

export async function POST(request: Request) {
  // A table QR always posts from this origin; a foreign page may not.
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const requestId = requestIdFrom(request);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse("payload_too_large", "That order is too large to submit.", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = orderBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_body", parsed.error.issues[0]?.message ?? "Invalid body.", 400);
  }
  if (parsed.data.website?.trim()) {
    // Bot bait. Refuse without touching the database so nothing is counted.
    return errorResponse("invalid_body", "That submission could not be accepted.", 400);
  }

  const now = new Date();
  try {
    const limit = await consumeOrderRateLimit(getDb(), callerBucket(request, now), now);
    if (!limit.allowed) {
      logEvent("warn", "orders.rate_limited", { requestId, count: limit.count });
      // Volume signal: a single table can trip the minute limit by mistake,
      // so this is throttled to one email per hour by the alert key.
      await alertOps({
        subject: "Order rate limit reached",
        details: `A caller hit the order rate limit (${limit.count} attempts in one minute). If this is not a busy service, someone is abusing the public endpoint.`,
        dedupeKey: "orders.rate_limited",
      });
      const response = errorResponse(
        "rate_limited",
        "Too many orders from this connection. Wait a minute and try again.",
        429
      );
      response.headers.set("Retry-After", "60");
      return response;
    }

    // The schema's refine above guarantees exactly one shape: a body that
    // names a menu on every line is the table path, a body carrying `slug`
    // is the single-menu path (always with the café it was printed under).
    // Branch on `slug` first — single-menu links send both.
    if (parsed.data.slug && !parsed.data.restaurantSlug) {
      return errorResponse("invalid_body", "A menu or restaurant link is required.", 400);
    }
    const order = parsed.data.slug
      ? await placeOrderFromSlug(getDb(), {
          slug: parsed.data.slug,
          restaurantSlug: parsed.data.restaurantSlug ?? "",
          tableLabel: parsed.data.tableLabel,
          note: parsed.data.note ?? null,
          lines: parsed.data.lines.map((line) => ({
            menuItemId: line.menuItemId,
            variantName: line.variantName,
            quantity: line.quantity,
          })),
        })
      : parsed.data.restaurantSlug
        ? await placeTableOrder(getDb(), {
            restaurantSlug: parsed.data.restaurantSlug,
            tableLabel: parsed.data.tableLabel,
            note: parsed.data.note ?? null,
            lines: parsed.data.lines.map((line) => ({
              menuSlug: line.menuSlug ?? "",
              menuItemId: line.menuItemId,
              variantName: line.variantName,
              quantity: line.quantity,
            })),
          })
        : null;
    if (!order) {
      return errorResponse("invalid_body", "A menu or restaurant link is required.", 400);
    }
    const response = NextResponse.json({ order }, { status: 201 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) return mapRepoError(error);
    // Server-side only: the browser gets a plain 503, the operator gets the
    // cause in the logs (never the other way around).
    await reportError("orders.place_failed", error, { requestId });
    return errorResponse("server_db_unavailable", "Could not place the order. Try again.", 503);
  }
}

function requireUser(): Promise<string | NextResponse> {
  return getSessionUserId()
    .then((userId) =>
      userId ?? errorResponse("unauthorized", "Sign in to continue.", 401)
    )
    .catch(() =>
      errorResponse(
        "server_db_unavailable",
        "Server sync is not available yet — keep working locally.",
        503
      )
    );
}

export async function GET(request: Request) {
  const userId = await requireUser();
  if (userId instanceof NextResponse) return userId;

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const restaurantId = url.searchParams.get("restaurantId");
  const limitParam = Number(url.searchParams.get("limit") ?? "");

  try {
    const result = await listOrdersForStaff(getDb(), userId, {
      since,
      restaurantId,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    });
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof OrderRepoError) return mapRepoError(error);
    await reportError("orders.board_failed", error, {
      requestId: requestIdFrom(request),
    });
    return errorResponse("server_db_unavailable", "Could not load orders. Try again.", 503);
  }
}
