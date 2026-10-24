/**
 * Server-side feature flag configuration and evaluation (A4).
 *
 * Release decisions live in one server env var, `FEATURE_FLAGS` (JSON), so a
 * deploy can release a feature to everyone, to named accounts, or as a
 * preview link without a code change. The browser never sees this config or
 * the allowlists — only `/api/features`' evaluated booleans.
 *
 * Evaluation order, per flag:
 *   1. `disabled` wins over everything (an emergency stop).
 *   2. `enabled` (or the registry default) releases it to every signed-in user.
 *   3. `userIds` / `emails` release it to named accounts while `enabled` is false.
 *   4. `preview` + a `?ff=<key>` preview releases it to that signed-in browser.
 *   5. Otherwise it is off.
 *
 * A URL preview is a convenience for review, never an authorization boundary:
 * the server still applies the feature's own ownership and usage checks.
 */

import { z } from "zod";

import {
  FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
  type FeatureFlags,
} from "./registry";

export const FEATURE_FLAGS_ENV = "FEATURE_FLAGS";

const overrideSchema = z
  .object({
    /** Release to every signed-in account. */
    enabled: z.boolean().optional(),
    /** Emergency stop; overrides every other field. */
    disabled: z.boolean().optional(),
    /** Allowlisted account emails (matched case-insensitively). */
    emails: z
      .array(
        z
          .string()
          .trim()
          .email()
          .transform((value) => value.toLowerCase())
      )
      .max(500)
      .optional(),
    /** Allowlisted Better Auth user ids. */
    userIds: z.array(z.string().trim().min(1).max(200)).max(500).optional(),
    /** Allow `?ff=<key>` previews for this flag. */
    preview: z.boolean().optional(),
  })
  .strict();

export type FeatureFlagOverride = z.infer<typeof overrideSchema>;
export type FeatureFlagConfig = Partial<Record<FeatureFlagKey, FeatureFlagOverride>>;

export interface FeatureFlagContext {
  userId: string;
  email?: string | null;
  previewKeys?: readonly FeatureFlagKey[];
}

/**
 * Parse the JSON config. A malformed value or an invalid flag block is
 * ignored (the registry default stands) instead of breaking every request:
 * a deployment typo must never take the app down, only fail closed.
 */
export function parseFeatureFlagConfig(raw: string | undefined): FeatureFlagConfig {
  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const config: FeatureFlagConfig = {};
  for (const key of FEATURE_FLAG_KEYS) {
    const candidate = (parsed as Record<string, unknown>)[key];
    if (candidate === undefined) continue;
    const result = overrideSchema.safeParse(candidate);
    if (result.success) config[key] = result.data;
  }
  return config;
}

export function readFeatureFlagConfig(
  env: Record<string, string | undefined> = process.env
): FeatureFlagConfig {
  return parseFeatureFlagConfig(env[FEATURE_FLAGS_ENV]);
}

export function evaluateFeatureFlags(
  context: FeatureFlagContext,
  config: FeatureFlagConfig = readFeatureFlagConfig()
): FeatureFlags {
  const previewKeys = new Set(context.previewKeys ?? []);
  const email = context.email?.trim().toLowerCase() ?? null;
  const flags = {} as FeatureFlags;

  for (const key of FEATURE_FLAG_KEYS) {
    const definition = FEATURE_FLAGS[key];
    const override = config[key];

    if (override?.disabled) {
      flags[key] = false;
      continue;
    }
    if (override?.enabled ?? definition.defaultEnabled) {
      flags[key] = true;
      continue;
    }
    if (override?.userIds?.includes(context.userId)) {
      flags[key] = true;
      continue;
    }
    if (email && override?.emails?.includes(email)) {
      flags[key] = true;
      continue;
    }
    if ((override?.preview ?? definition.defaultPreview) && previewKeys.has(key)) {
      flags[key] = true;
      continue;
    }
    flags[key] = false;
  }
  return flags;
}
