/**
 * Server-only flag resolution for route handlers (A4).
 *
 * The proxy forwards the current preview keys on the request (and persists
 * them in an HttpOnly cookie for later requests). This module turns that plus
 * the signed-in account and the server config into the one flag map a route
 * or `/api/features` may use. Keep it out of client bundles.
 */

import { getSessionUser, type SessionUser } from "@/lib/auth/session";

import { evaluateFeatureFlags, readFeatureFlagConfig, type FeatureFlagConfig } from "./config";
import { previewKeysFromRequest } from "./preview";
import type { FeatureFlagKey, FeatureFlags } from "./registry";

export interface FeatureContext {
  user: SessionUser;
  flags: FeatureFlags;
  preview: FeatureFlagKey[];
}

type ResolveOptions = {
  config?: FeatureFlagConfig;
  env?: Record<string, string | undefined>;
};

/**
 * The signed-in account plus its evaluated flags, or null when signed out.
 * A session lookup failure propagates so the caller can answer 503 instead of
 * pretending the account has no access.
 */
export async function resolveFeatureContext(
  request?: Request | null,
  options: ResolveOptions = {}
): Promise<FeatureContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const preview = previewKeysFromRequest(request);
  const config = options.config ?? readFeatureFlagConfig(options.env);
  return {
    user,
    flags: evaluateFeatureFlags(
      { userId: user.id, email: user.email, previewKeys: preview },
      config
    ),
    preview,
  };
}
