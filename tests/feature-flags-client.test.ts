import { describe, expect, it, vi } from "vitest";

import { fetchFeatureFlags } from "@/features/flags/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchFeatureFlags", () => {
  it("reads evaluated flags and preview keys without caching", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        flags: { assistant: true, assistantProposals: true },
        preview: ["assistantProposals"],
      })
    );

    expect(await fetchFeatureFlags(fetchImpl)).toEqual({
      flags: { assistant: true, assistantProposals: true },
      preview: ["assistantProposals"],
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/features");
    expect((fetchImpl.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
  });

  it("fills missing known flags from the conservative defaults", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ flags: { assistant: false }, preview: [] }));

    expect(await fetchFeatureFlags(fetchImpl)).toEqual({
      flags: { assistant: false, assistantProposals: false },
      preview: [],
    });
  });

  it("drops unknown preview names and ignores unknown flag keys", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        flags: { assistant: true, assistantProposals: true, someoneElsesFlag: true },
        preview: ["assistantProposals", "not-a-flag"],
      })
    );

    const snapshot = await fetchFeatureFlags(fetchImpl);
    expect(snapshot.flags).toEqual({ assistant: true, assistantProposals: true });
    expect(snapshot.preview).toEqual(["assistantProposals"]);
  });

  it("fails loudly on an error status or a malformed envelope", async () => {
    await expect(
      fetchFeatureFlags(
        vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            jsonResponse({ error: { code: "unauthorized", message: "Sign in." } }, 401)
          )
      )
    ).rejects.toThrow("Feature access could not be loaded.");

    await expect(
      fetchFeatureFlags(vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ flags: "yes" })))
    ).rejects.toThrow("could not understand");
  });
});
