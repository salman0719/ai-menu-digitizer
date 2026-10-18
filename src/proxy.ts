import { NextResponse, type NextRequest } from "next/server";

import { sanitizeRequestId } from "@/lib/observability/log";

/**
 * Proxy (Next 16's renamed middleware) — one job for now: attach a request id.
 *
 * Every server log line for this request carries it, and it is echoed on the
 * response, so a user can screenshot `x-request-id` from the network tab and
 * we can find the exact failure. An inbound id is reused only when it looks
 * like an id (see `sanitizeRequestId`) — otherwise a hostile header could
 * inject arbitrary text into our logs.
 *
 * Nothing else runs here: session checks stay in the routes that own them
 * (the docs are explicit that proxy is not an authorization layer).
 */
export function proxy(request: NextRequest): NextResponse {
  const requestId =
    sanitizeRequestId(request.headers.get("x-request-id")) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  /**
   * Skip static assets: they need no id, and matching every file would put a
   * function invocation in front of every image.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js|woff2?)$).*)"],
};
