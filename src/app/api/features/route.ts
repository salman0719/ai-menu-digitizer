import { NextResponse } from "next/server";

import { resolveFeatureContext } from "@/features/flags/server";
import { logEvent, requestIdFrom } from "@/lib/observability/log";

/**
 * GET /api/features — the signed-in caller's evaluated feature flags (A4).
 *
 * Only booleans and the preview key names leave the server; the flag config,
 * allowlists and user ids never do. Responses are private and never cached, so
 * a release decision applies on the next page load.
 */

function errorResponse(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = requestIdFrom(request);

  let context: Awaited<ReturnType<typeof resolveFeatureContext>>;
  try {
    context = await resolveFeatureContext(request);
  } catch (error) {
    logEvent("warn", "features.resolve_failed", { requestId, error });
    return errorResponse(
      "server_db_unavailable",
      "Feature access is not available right now. Try again in a moment.",
      503
    );
  }

  if (!context) {
    return errorResponse("unauthorized", "Sign in to see feature access.", 401);
  }

  return NextResponse.json(
    { flags: context.flags, preview: context.preview },
    { headers: { "Cache-Control": "no-store" } }
  );
}
