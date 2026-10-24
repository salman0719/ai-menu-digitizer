import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/features/route";

/**
 * `/api/features` never exposes config or allowlists: these tests prove the
 * release decisions (global, named account, preview link, kill switch) and
 * that the response is private.
 */

const holder: { user: { id: string; email: string } | null } = { user: null };

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(async () => holder.user),
}));

const originalFeatureFlags = process.env.FEATURE_FLAGS;

beforeEach(() => {
  holder.user = null;
  delete process.env.FEATURE_FLAGS;
});

afterEach(() => {
  if (originalFeatureFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = originalFeatureFlags;
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/api/features", { headers });
}

describe("GET /api/features", () => {
  it("returns 401 when signed out", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("returns the conservative defaults and never caches", async () => {
    holder.user = { id: "user-1", email: "owner@cafe.test" };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      flags: { assistant: true, assistantProposals: false },
      preview: [],
    });
  });

  it("releases a flag globally and still hides a stopped one", async () => {
    holder.user = { id: "user-1", email: "owner@cafe.test" };
    process.env.FEATURE_FLAGS = JSON.stringify({
      assistantProposals: { enabled: true },
      assistant: { disabled: true },
    });

    const payload = await (await GET(request())).json();
    expect(payload.flags).toEqual({ assistant: false, assistantProposals: true });
  });

  it("releases a flag to an allowlisted email only", async () => {
    holder.user = { id: "user-1", email: "Owner@Cafe.Test" };
    process.env.FEATURE_FLAGS = JSON.stringify({
      assistantProposals: { emails: ["owner@cafe.test"] },
    });

    expect((await (await GET(request())).json()).flags.assistantProposals).toBe(true);
  });

  it("accepts a preview from the proxy header when the flag allows it", async () => {
    holder.user = { id: "user-1", email: "owner@cafe.test" };
    process.env.FEATURE_FLAGS = JSON.stringify({
      assistantProposals: { preview: true },
    });

    const payload = await (
      await GET(request({ "x-eateryo-ff-preview": "assistantProposals" }))
    ).json();
    expect(payload.flags.assistantProposals).toBe(true);
    expect(payload.preview).toEqual(["assistantProposals"]);
  });

  it("accepts the proposal preview by default when FEATURE_FLAGS is unset", async () => {
    holder.user = { id: "user-1", email: "owner@cafe.test" };

    const payload = await (
      await GET(request({ "x-eateryo-ff-preview": "assistantProposals" }))
    ).json();
    expect(payload.flags).toEqual({ assistant: true, assistantProposals: true });
    expect(payload.preview).toEqual(["assistantProposals"]);
  });

  it("accepts a persisted preview cookie and ignores it when preview is off", async () => {
    holder.user = { id: "user-1", email: "owner@cafe.test" };
    process.env.FEATURE_FLAGS = JSON.stringify({
      assistantProposals: { preview: true },
    });

    const withCookie = await (
      await GET(request({ cookie: "eateryo_ff_preview=assistantProposals" }))
    ).json();
    expect(withCookie.flags.assistantProposals).toBe(true);

    process.env.FEATURE_FLAGS = JSON.stringify({ assistantProposals: { preview: false } });
    const refused = await (
      await GET(request({ cookie: "eateryo_ff_preview=assistantProposals" }))
    ).json();
    expect(refused.flags.assistantProposals).toBe(false);
  });

  it("fails closed to defaults when the env JSON is invalid", async () => {
    holder.user = { id: "user-1", email: "owner@cafe.test" };
    process.env.FEATURE_FLAGS = "{not json";

    const payload = await (await GET(request())).json();
    expect(payload.flags).toEqual({ assistant: true, assistantProposals: false });
  });
});
