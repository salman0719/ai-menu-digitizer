import { NextResponse, type NextRequest } from "next/server";

import { getPublishedMenuBySlug } from "@/features/publishing/repo";
import { publicationPath } from "@/features/publishing/schema";
import { isSlug } from "@/features/publishing/slug";
import { getDb } from "@/lib/db";
import { sanitizeRequestId } from "@/lib/observability/log";

/**
 * Proxy (Next 16's renamed middleware) — two jobs:
 *
 * 1. Attach a request id. Every server log line for this request carries it,
 *    and it is echoed on the response, so a user can screenshot `x-request-id`
 *    from the network tab and we can find the exact failure. An inbound id is
 *    reused only when it looks like an id (see `sanitizeRequestId`) —
 *    otherwise a hostile header could inject arbitrary text into our logs.
 *
 * 2. Keep the old global menu addresses working. Menu pages used to live at
 *    `/m/<slug>`; they now live under the café at
 *    `/r/<restaurant>/m/<menu>`, so anything still asking for the old shape —
 *    a printed QR code, a shared link, a bookmark — is answered with a real
 *    308 to the canonical address instead of a 404. The old view beacon
 *    (`/api/m/<slug>/view`) moves the same way, so a stale page keeps
 *    counting honestly.
 *
 * A redirect only happens when the slug names a live menu, and it always
 * points at that menu's current address; an unknown, unpublished, or
 * renamed-away slug falls through to the route, which answers 404. When the
 * database cannot be read at all, we fall through too — a redirect is a
 * convenience, never a reason to fail the request.
 *
 * Session checks stay in the routes that own them (the docs are explicit that
 * proxy is not an authorization layer), and this redirect reveals nothing: a
 * slug that is not live is indistinguishable from one that never existed.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestId =
    sanitizeRequestId(request.headers.get("x-request-id")) ?? crypto.randomUUID();

  const legacyTarget = await resolveLegacyTarget(request);
  if (legacyTarget) {
    const response = NextResponse.redirect(new URL(legacyTarget, request.url), 308);
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

/** `/m/<slug>(/…)` and `/api/m/<slug>/view` — the two legacy address shapes. */
const LEGACY_MENU_PATH = /^\/m\/([^/]+)(\/[^?#]*)?$/;
const LEGACY_VIEW_PATH = /^\/api\/m\/([^/]+)\/view$/;

/**
 * Where a legacy request should go, or null to leave it alone. The slug is
 * resolved through the same reservation the rest of the app uses, so the
 * redirect can never send a diner to a menu that is not serving — or to a
 * different café's menu.
 */
async function resolveLegacyTarget(request: NextRequest): Promise<string | null> {
  const pathname = request.nextUrl.pathname;
  const view = pathname.match(LEGACY_VIEW_PATH);
  const menu = view ? null : pathname.match(LEGACY_MENU_PATH);
  const match = view
    ? { slug: view[1], rest: "", api: true }
    : menu
      ? { slug: menu[1], rest: menu[2] ?? "", api: false }
      : null;
  if (!match) return null;
  if (!isSlug(decodeSafely(match.slug))) return null;

  let target: Awaited<ReturnType<typeof getPublishedMenuBySlug>>;
  try {
    target = await getPublishedMenuBySlug(getDb(), match.slug);
  } catch {
    return null;
  }
  if (!target) return null;

  const base = match.api
    ? `/api/r/${target.restaurantSlug}/m/${target.slug}/view`
    : `${publicationPath(target.restaurantSlug, target.slug)}${match.rest}`;
  return `${base}${request.nextUrl.search}`;
}

/** Slugs are ASCII by rule; anything that will not decode is not a slug. */
function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export const config = {
  /**
   * Skip static assets: they need no id, and matching every file would put a
   * function invocation in front of every image.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|css|js|woff2?)$).*)"],
};
