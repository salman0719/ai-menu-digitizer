import { NextResponse } from "next/server";

import { getAssistantSpendSummary } from "@/features/assistant/repo";
import { getLaunchSnapshot } from "@/features/launch/repo";
import { getMonthlyUsageSummary } from "@/features/usage/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";

/**
 * GET /api/launch — the signed-in account's onboarding state: how many menus
 * exist, whether one is live, how many orders have arrived, what still needs
 * a price, and this month's extraction + assistant spend against their caps.
 *
 * One request feeds the whole checklist; personalized, so never cached.
 */
export async function GET(): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "server_db_unavailable",
          message: "Server data is not available yet — keep working locally.",
        },
      },
      { status: 503 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to see your launch checklist." } },
      { status: 401 }
    );
  }

  try {
    const db = getDb();
    const [snapshot, usage, assistant] = await Promise.all([
      getLaunchSnapshot(db, userId),
      getMonthlyUsageSummary(db, userId),
      getAssistantSpendSummary(db, userId),
    ]);
    const response = NextResponse.json({ launch: { ...snapshot, usage, assistant } });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await reportError("launch.status_failed", error);
    return NextResponse.json(
      { error: { code: "server_db_unavailable", message: "Could not load your checklist." } },
      { status: 503 }
    );
  }
}
