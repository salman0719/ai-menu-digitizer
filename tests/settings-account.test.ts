import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UsageSummary } from "@/features/usage/schema";

/**
 * R0.5 — the `/launch` cleanup. Export/delete and usage moved to Settings
 * ("Data & privacy" and "Usage"); the launch page is back to the checklist
 * plus marketing copy. Static rendering is enough: the gate is a session
 * decision, the nudge is a pure function, and the loading skeleton pins that
 * no usage numbers render before the account data lands.
 */

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: sessionState.user ? { user: sessionState.user } : null,
      isPending: false,
    }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {} }),
}));

import { DataControls } from "@/components/launch/data-controls";
import { UsagePanel, extractNudge } from "@/components/settings/usage-panel";
import LaunchPage from "@/app/launch/page";

function usage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-11-01T00:00:00.000Z",
    requests: 3,
    succeeded: 3,
    failed: 0,
    pages: 5,
    inputTokens: 12000,
    outputTokens: 800,
    costMicros: 1500,
    unpricedRequests: 0,
    cap: 150,
    remaining: 147,
    ratesConfigured: true,
    ...overrides,
  };
}

function signIn() {
  sessionState.user = { id: "u-1", email: "owner@cafe.test", name: "Owner" };
}

describe("extractNudge", () => {
  it("points at capture while free extractions remain", () => {
    expect(extractNudge(usage({ remaining: 147, cap: 150 }))).toEqual({
      href: "/",
      label: "Upload a menu photo",
      body: "147 of 150 free extractions left this month.",
    });
  });

  it("returns null at zero so the panel shows the reset date instead", () => {
    expect(extractNudge(usage({ remaining: 0, requests: 150 }))).toBeNull();
  });
});

describe("DataControls sign-in gate", () => {
  it("renders nothing when signed out", () => {
    sessionState.user = null;
    expect(renderToStaticMarkup(createElement(DataControls))).toBe("");
  });

  it("renders export and delete once signed in", () => {
    signIn();
    try {
      const html = renderToStaticMarkup(createElement(DataControls));
      expect(html).toContain("Data &amp; privacy");
      expect(html).toContain("Export my data");
      expect(html).toContain("Delete my account");
    } finally {
      sessionState.user = null;
    }
  });
});

describe("UsagePanel loading", () => {
  it("skeleton-first: no usage numbers before the account data lands", () => {
    signIn();
    try {
      const html = renderToStaticMarkup(createElement(UsagePanel));
      expect(html).toContain("Checking your usage");
      expect(html).not.toContain("free extractions used");
    } finally {
      sessionState.user = null;
    }
  });
});

describe("launch page cleanup", () => {
  it("keeps the marketing and checklist entry, without the account sections", () => {
    signIn();
    try {
      const html = renderToStaticMarkup(createElement(LaunchPage));
      expect(html).toContain("Free while it lasts");
      expect(html).not.toContain("Export my data");
      expect(html).not.toContain("Delete my account");
      expect(html).not.toContain("AI extraction this month");
    } finally {
      sessionState.user = null;
    }
  });
});
