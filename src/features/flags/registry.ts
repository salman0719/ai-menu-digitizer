/**
 * Feature flag registry (A4).
 *
 * A flag is a named release decision. This file is the single list of flags
 * the app knows: adding one here makes it configurable, and an env entry for
 * an unknown key is ignored so a typo cannot silently create a flag.
 *
 * Defaults are deliberately conservative: nothing is released by default;
 * preview links are how work in progress is checked. Only the server
 * evaluates a flag; the browser receives the result from `/api/features`.
 */

export interface FeatureFlagDefinition {
  /** One line for operators; never shown as a promise to users. */
  description: string;
  /** Signed-in accounts get the feature when this is true. */
  defaultEnabled: boolean;
  /** Allow `?ff=<key>` preview links when this is true. */
  defaultPreview: boolean;
}

export const FEATURE_FLAGS = {
  assistant: {
    description:
      "The signed-in Assistant tab and help chat (A1). Off by default; preview it with ?ff=assistant (help only) or ?ff=assistantProposals (help plus proposals).",
    defaultEnabled: false,
    defaultPreview: false,
  },
  assistantProposals: {
    description:
      "AI-proposed menu edits with review and approval (A2/A3). Releasing it also releases the Assistant it lives in.",
    defaultEnabled: false,
    defaultPreview: false,
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[];

/** Compiled defaults, used before `/api/features` answers and on fetch failure. */
export const DEFAULT_FEATURE_FLAGS = Object.freeze(
  Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, FEATURE_FLAGS[key].defaultEnabled]))
) as Readonly<FeatureFlags>;

/** HttpOnly cookie that carries preview keys set by `?ff=`. */
export const FEATURE_PREVIEW_COOKIE = "eateryo_ff_preview";
/** Query parameter that enables a preview (comma-separated keys allowed). */
export const FEATURE_PREVIEW_PARAM = "ff";
/** Header forwarded by the proxy so the first request already sees its preview. */
export const FEATURE_PREVIEW_HEADER = "x-eateryo-ff-preview";
/** A preview cookie is a convenience, not a place to store a long list. */
export const FEATURE_PREVIEW_MAX_KEYS = 5;
/** Long enough for a stakeholder review, short enough to expire on its own. */
export const FEATURE_PREVIEW_TTL_SECONDS = 60 * 60 * 24 * 30;

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(value);
}

/** Parse a comma-separated preview list; unknown keys are dropped. */
export function parseFeaturePreviewKeys(value: string | null | undefined): FeatureFlagKey[] {
  if (!value) return [];
  const keys = value
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is FeatureFlagKey => part.length > 0 && isFeatureFlagKey(part));
  return [...new Set(keys)].slice(0, FEATURE_PREVIEW_MAX_KEYS);
}

/**
 * Merge the keys already in the preview cookie with the ones in the current
 * URL. `?ff=off` (or `none`) clears the preview; it can be combined with keys
 * to start a fresh set. Returns an empty list plus `clear` when the cookie
 * should be removed.
 */
export function mergeFeaturePreviewKeys(
  existingValue: string | null | undefined,
  requestedValue: string | null | undefined
): { keys: FeatureFlagKey[]; clear: boolean } {
  const requestedParts = (requestedValue ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const clear = requestedParts.some((part) => {
    const normalized = part.toLowerCase();
    return normalized === "off" || normalized === "none";
  });
  const requested = parseFeaturePreviewKeys(requestedValue);
  const existing = clear ? [] : parseFeaturePreviewKeys(existingValue);
  return {
    keys: [...new Set([...existing, ...requested])].slice(0, FEATURE_PREVIEW_MAX_KEYS),
    clear,
  };
}
