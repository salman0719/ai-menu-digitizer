import { NextResponse } from "next/server";

import { buildAccountExport } from "@/features/retention/repo";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/alerts";

/**
 * GET /api/account/export — everything this account can see, as a JSON
 * download: account details, restaurants, menus (drafts), live publications
 * with the snapshot the public reads, and orders with their lines.
 *
 * Session-scoped: the id comes from the verified session, so the export can
 * never include another tenant's data.
 */
export async function GET(): Promise<NextResponse> {
  let userId: string | null;
  try {
    userId = await getSessionUserId();
  } catch {
    return NextResponse.json(
      { error: { code: "server_db_unavailable", message: "The export is not available yet." } },
      { status: 503 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to export your data." } },
      { status: 401 }
    );
  }

  try {
    const data = await buildAccountExport(getDb(), userId);
    const filename = `tablepass-export-${data.exportedAt.slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    await reportError("account.export_failed", error);
    return NextResponse.json(
      { error: { code: "export_failed", message: "Could not build the export. Try again." } },
      { status: 503 }
    );
  }
}
