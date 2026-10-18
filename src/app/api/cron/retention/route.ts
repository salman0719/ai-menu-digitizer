import { NextResponse } from "next/server";

import { isCronAuthorized, purgeOldOrders } from "@/features/retention/repo";
import {
  ORDER_RETENTION_DAYS_ENV,
  orderRetentionDays,
  retentionCutoff,
} from "@/features/retention/schema";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";
import { logInfo } from "@/lib/observability/log";

/**
 * GET /api/cron/retention — the scheduled purge (Vercel cron, see vercel.json).
 *
 * Orders older than the retention window are deleted; menus and publications
 * are never touched. Vercel sends `Authorization: Bearer $CRON_SECRET` when
 * the variable is set, and the route refuses everything else — without the
 * secret it is not a public "delete data" button.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not authorized." } },
      { status: 401 }
    );
  }

  const now = new Date();
  const days = orderRetentionDays();
  const before = retentionCutoff(now, days);

  try {
    const purged = await purgeOldOrders(getDb(), before, now);
    logInfo("retention.purged", {
      days,
      cutoff: before.toISOString(),
      orders: purged.orders,
      rateLimitWindows: purged.rateLimitWindows,
    });
    return NextResponse.json(
      { purged, cutoff: before.toISOString(), days },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    await reportError("retention.purge_failed", error, {
      days,
      hint: `Check ${ORDER_RETENTION_DAYS_ENV} and the database connection.`,
    });
    return NextResponse.json(
      { error: { code: "purge_failed", message: "Could not purge old orders." } },
      { status: 503 }
    );
  }
}
