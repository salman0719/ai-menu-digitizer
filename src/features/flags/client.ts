"use client";

/**
 * Browser client for `/api/features` (A4).
 *
 * The server evaluates every flag; this module only fetches the result and
 * fills in compiled defaults for keys the server did not send. A failed fetch
 * therefore hides unreleased features (their defaults are off) while leaving
 * a released feature such as the Assistant usable.
 */

import { useEffect, useState } from "react";
import { z } from "zod";

import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_KEYS,
  isFeatureFlagKey,
  type FeatureFlagKey,
  type FeatureFlags,
} from "./registry";

const featureFlagsEnvelopeSchema = z.object({
  flags: z.record(z.string(), z.boolean()),
  preview: z.array(z.string()).default([]),
});

export interface FeatureFlagsSnapshot {
  flags: FeatureFlags;
  preview: FeatureFlagKey[];
}

export interface UseFeatureFlagsResult extends FeatureFlagsSnapshot {
  loading: boolean;
  error: string | null;
}

const FALLBACK: FeatureFlagsSnapshot = {
  flags: { ...DEFAULT_FEATURE_FLAGS },
  preview: [],
};

function snapshotFrom(payload: unknown): FeatureFlagsSnapshot | null {
  const parsed = featureFlagsEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return null;

  const flags = { ...DEFAULT_FEATURE_FLAGS } as FeatureFlags;
  for (const key of FEATURE_FLAG_KEYS) {
    const value = parsed.data.flags[key];
    if (typeof value === "boolean") flags[key] = value;
  }
  return {
    flags,
    preview: parsed.data.preview.filter(isFeatureFlagKey),
  };
}

export async function fetchFeatureFlags(
  fetchImpl: typeof fetch = fetch
): Promise<FeatureFlagsSnapshot> {
  let response: Response;
  try {
    response = await fetchImpl("/api/features", { cache: "no-store" });
  } catch {
    throw new Error("Could not reach the server to load feature access.");
  }

  if (!response.ok) throw new Error("Feature access could not be loaded.");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const snapshot = snapshotFrom(payload);
  if (!snapshot) {
    throw new Error("The server sent feature access data this app could not understand.");
  }
  return snapshot;
}

interface FeatureFlagsState {
  /** Which account the snapshot belongs to; null before the first answer. */
  userId: string | null;
  snapshot: FeatureFlagsSnapshot;
  error: string | null;
}

const INITIAL_STATE: FeatureFlagsState = {
  userId: null,
  snapshot: FALLBACK,
  error: null,
};

/**
 * Evaluated flags for one account. The snapshot is tagged with the account id
 * so switching accounts shows conservative defaults until the new answer
 * arrives instead of briefly inheriting the previous account's release.
 */
export function useFeatureFlags(userId: string | null | undefined): UseFeatureFlagsResult {
  const id = userId ?? null;
  const [state, setState] = useState<FeatureFlagsState>(INITIAL_STATE);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchFeatureFlags();
        if (!cancelled) setState({ userId: id, snapshot: next, error: null });
      } catch {
        if (cancelled) return;
        // Keep the compiled defaults: released features stay usable, and
        // unreleased ones remain hidden until the server answers.
        setState({
          userId: id,
          snapshot: FALLBACK,
          error: "Feature access could not be loaded. Some features may be hidden.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const active = id !== null && state.userId === id;
  return {
    ...(active ? state.snapshot : FALLBACK),
    loading: id !== null && !active,
    error: active ? state.error : null,
  };
}
