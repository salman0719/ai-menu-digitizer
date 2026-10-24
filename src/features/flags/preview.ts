/**
 * Preview keys carried by one request (A4).
 *
 * The proxy owns the header and cookie; this module only reads them. It is
 * intentionally free of auth and DB imports so pure tests can exercise it.
 */

import {
  FEATURE_PREVIEW_COOKIE,
  FEATURE_PREVIEW_HEADER,
  parseFeaturePreviewKeys,
  type FeatureFlagKey,
} from "./registry";

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The proxy-owned header wins when present (even when empty: that is how
 * `?ff=off` takes effect immediately); the cookie covers later requests.
 */
export function previewKeysFromRequest(request: Request | null | undefined): FeatureFlagKey[] {
  if (request) {
    const header = request.headers.get(FEATURE_PREVIEW_HEADER);
    if (header !== null) return parseFeaturePreviewKeys(header);
  }
  const cookie = readCookie(request?.headers.get("cookie") ?? null, FEATURE_PREVIEW_COOKIE);
  return parseFeaturePreviewKeys(cookie);
}
