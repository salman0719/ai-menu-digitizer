import { NextResponse, type NextRequest } from "next/server";

import {
  FEATURE_PREVIEW_COOKIE,
  FEATURE_PREVIEW_HEADER,
  FEATURE_PREVIEW_PARAM,
  FEATURE_PREVIEW_TTL_SECONDS,
  mergeFeaturePreviewKeys,
} from "@/features/flags/registry";
import { sanitizeRequestId } from "@/lib/observability/log";

/**
 * Proxy (Next 16's renamed middleware) — one job:
 *
 * Attach a request id. Every server log line for this request carries it,
 * and it is echoed on the response, so a user can screenshot `x-request-id`
 * from the network tab and we can find the exact failure. An inbound id is
 * reused only when it looks like an id (see `sanitizeRequestId`) —
 * otherwise a hostile header could inject arbitrary text into our logs.
 *
 * Session checks stay in the routes that own them (the docs are explicit that
 * proxy is not an authorization layer).
 *
 * Feature previews are the one exception to "proxy does no product logic":
 * it translates `?ff=<flag>` into the HttpOnly preview cookie and a request
 * header, so the server-side flag evaluation on this same request already
 * sees the preview. It still only forwards known flag names; the actual
 * access check remains in the routes.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestId = sanitizeRequestId(request.headers.get("x-request-id")) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const rawPreview = request.nextUrl.searchParams.getAll(FEATURE_PREVIEW_PARAM).join(",");
  const preview = mergeFeaturePreviewKeys(
    request.cookies.get(FEATURE_PREVIEW_COOKIE)?.value ?? null,
    rawPreview
  );

  if (rawPreview.length > 0) {
    // Empty is meaningful: it makes `?ff=off` take effect on this request.
    requestHeaders.set(FEATURE_PREVIEW_HEADER, preview.keys.join(","));
  } else {
    // Never trust a browser-supplied preview header.
    requestHeaders.delete(FEATURE_PREVIEW_HEADER);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);

  if (rawPreview.length > 0 && preview.keys.length > 0) {
    response.cookies.set(FEATURE_PREVIEW_COOKIE, preview.keys.join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: FEATURE_PREVIEW_TTL_SECONDS,
    });
  } else if (rawPreview.length > 0 && preview.clear) {
    response.cookies.delete(FEATURE_PREVIEW_COOKIE);
  }

  return response;
}

export const config = {
  /**
   * Skip static assets: they need no id, and matching every file would put a
   * function invocation in front of every image.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js|woff2?)$).*)",
  ],
};
