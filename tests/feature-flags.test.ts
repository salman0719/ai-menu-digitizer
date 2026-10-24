import { describe, expect, it } from "vitest";

import {
  evaluateFeatureFlags,
  parseFeatureFlagConfig,
  readFeatureFlagConfig,
} from "@/features/flags/config";
import { previewKeysFromRequest } from "@/features/flags/preview";
import {
  FEATURE_PREVIEW_COOKIE,
  FEATURE_PREVIEW_HEADER,
  mergeFeaturePreviewKeys,
  parseFeaturePreviewKeys,
} from "@/features/flags/registry";

describe("parseFeatureFlagConfig", () => {
  it("returns an empty config for missing, malformed or non-object values", () => {
    expect(parseFeatureFlagConfig(undefined)).toEqual({});
    expect(parseFeatureFlagConfig("   ")).toEqual({});
    expect(parseFeatureFlagConfig("{not json")).toEqual({});
    expect(parseFeatureFlagConfig("[]")).toEqual({});
    expect(parseFeatureFlagConfig("null")).toEqual({});
  });

  it("parses a known flag and normalizes its email allowlist", () => {
    expect(
      parseFeatureFlagConfig('{"assistantProposals":{"enabled":true,"emails":["Owner@Cafe.Test"]}}')
    ).toEqual({
      assistantProposals: { enabled: true, emails: ["owner@cafe.test"] },
    });
  });

  it("ignores unknown flags and invalid flag blocks instead of throwing", () => {
    expect(
      parseFeatureFlagConfig(
        '{"nope":{"enabled":true},"assistant":{"enabled":"yes"},"assistantProposals":{"preview":true}}'
      )
    ).toEqual({ assistantProposals: { preview: true } });
  });

  it("reads the config from the server env", () => {
    expect(readFeatureFlagConfig({ FEATURE_FLAGS: '{"assistant":{"disabled":true}}' })).toEqual({
      assistant: { disabled: true },
    });
    expect(readFeatureFlagConfig({})).toEqual({});
  });
});

describe("evaluateFeatureFlags", () => {
  it("uses the conservative registry defaults", () => {
    const flags = evaluateFeatureFlags({ userId: "user-1" }, {});
    expect(flags.assistant).toBe(true);
    expect(flags.assistantProposals).toBe(false);
  });

  it("releases a flag to every signed-in account when enabled", () => {
    const flags = evaluateFeatureFlags(
      { userId: "user-1" },
      { assistantProposals: { enabled: true } }
    );
    expect(flags.assistantProposals).toBe(true);
  });

  it("lets an emergency stop override enabled and every allowlist", () => {
    const flags = evaluateFeatureFlags(
      { userId: "user-1", email: "owner@cafe.test" },
      {
        assistantProposals: {
          enabled: true,
          disabled: true,
          emails: ["owner@cafe.test"],
          userIds: ["user-1"],
          preview: true,
        },
      }
    );
    expect(flags.assistantProposals).toBe(false);
  });

  it("releases to an allowlisted user id or email while globally off", () => {
    const byId = evaluateFeatureFlags(
      { userId: "user-1" },
      { assistantProposals: { userIds: ["user-1"] } }
    );
    expect(byId.assistantProposals).toBe(true);

    const byEmail = evaluateFeatureFlags(
      { userId: "user-2", email: "Owner@Cafe.Test" },
      { assistantProposals: { emails: ["owner@cafe.test"] } }
    );
    expect(byEmail.assistantProposals).toBe(true);
  });

  it("does not leak an allowlist to a different account", () => {
    const flags = evaluateFeatureFlags(
      { userId: "user-2", email: "someone@else.test" },
      {
        assistantProposals: {
          emails: ["owner@cafe.test"],
          userIds: ["user-1"],
        },
      }
    );
    expect(flags.assistantProposals).toBe(false);
  });

  it("enables a preview only when the flag allows previews", () => {
    const allowed = evaluateFeatureFlags(
      { userId: "user-1", previewKeys: ["assistantProposals"] },
      { assistantProposals: { preview: true } }
    );
    expect(allowed.assistantProposals).toBe(true);

    const refused = evaluateFeatureFlags(
      { userId: "user-1", previewKeys: ["assistantProposals"] },
      {}
    );
    expect(refused.assistantProposals).toBe(false);
  });

  it("does not let a preview turn a released flag off", () => {
    const flags = evaluateFeatureFlags(
      { userId: "user-1", previewKeys: [] },
      { assistant: { preview: true } }
    );
    expect(flags.assistant).toBe(true);
  });
});

describe("feature preview keys", () => {
  it("parses, dedupes and drops unknown keys", () => {
    expect(parseFeaturePreviewKeys("assistant, assistantProposals,nope,assistant,, ")).toEqual([
      "assistant",
      "assistantProposals",
    ]);
    expect(parseFeaturePreviewKeys("")).toEqual([]);
    expect(parseFeaturePreviewKeys(null)).toEqual([]);
  });

  it("merges the cookie with the current link and can clear it", () => {
    expect(mergeFeaturePreviewKeys("assistant", "assistantProposals")).toEqual({
      keys: ["assistant", "assistantProposals"],
      clear: false,
    });
    expect(mergeFeaturePreviewKeys("assistant", "off")).toEqual({
      keys: [],
      clear: true,
    });
    expect(mergeFeaturePreviewKeys("assistant", "none,assistantProposals")).toEqual({
      keys: ["assistantProposals"],
      clear: true,
    });
  });

  it("prefers the proxy header, including an explicit empty clear", () => {
    const headers = new Headers({
      [FEATURE_PREVIEW_HEADER]: "assistant",
      cookie: `${FEATURE_PREVIEW_COOKIE}=assistantProposals`,
    });
    expect(previewKeysFromRequest(new Request("http://test.local", { headers }))).toEqual([
      "assistant",
    ]);

    const cleared = new Headers({
      [FEATURE_PREVIEW_HEADER]: "",
      cookie: `${FEATURE_PREVIEW_COOKIE}=assistantProposals`,
    });
    expect(previewKeysFromRequest(new Request("http://test.local", { headers: cleared }))).toEqual(
      []
    );
  });

  it("falls back to the preview cookie when the header is absent", () => {
    const headers = new Headers({
      cookie: `other=1; ${FEATURE_PREVIEW_COOKIE}=assistantProposals`,
    });
    expect(previewKeysFromRequest(new Request("http://test.local", { headers }))).toEqual([
      "assistantProposals",
    ]);
    expect(previewKeysFromRequest(undefined)).toEqual([]);
  });
});
