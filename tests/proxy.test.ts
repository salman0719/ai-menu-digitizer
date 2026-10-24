import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";
import { FEATURE_PREVIEW_COOKIE, FEATURE_PREVIEW_HEADER } from "@/features/flags/registry";

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("proxy feature previews", () => {
  it("turns ?ff= into the preview cookie and forwards it to this request", async () => {
    const response = await proxy(request("http://test.local/menus?ff=assistantProposals"));

    expect(response.cookies.get(FEATURE_PREVIEW_COOKIE)?.value).toBe("assistantProposals");
    expect(response.cookies.get(FEATURE_PREVIEW_COOKIE)?.httpOnly).toBe(true);
    expect(response.headers.get(`x-middleware-request-${FEATURE_PREVIEW_HEADER}`)).toBe(
      "assistantProposals"
    );
  });

  it("merges the current link with an existing preview cookie", async () => {
    const response = await proxy(
      request("http://test.local/?ff=assistantProposals", {
        cookie: `${FEATURE_PREVIEW_COOKIE}=assistant`,
      })
    );

    expect(response.cookies.get(FEATURE_PREVIEW_COOKIE)?.value).toBe(
      "assistant,assistantProposals"
    );
  });

  it("clears the cookie and suppresses the cookie's old keys on ?ff=off", async () => {
    const response = await proxy(
      request("http://test.local/?ff=off", {
        cookie: `${FEATURE_PREVIEW_COOKIE}=assistantProposals`,
      })
    );

    const cleared = response.cookies.get(FEATURE_PREVIEW_COOKIE);
    expect(cleared?.value).toBe("");
    const expires = cleared?.expires;
    const expiresAt = expires instanceof Date ? expires.getTime() : (expires ?? 0);
    expect(expiresAt).toBeLessThanOrEqual(Date.now());
    expect(response.headers.get(`x-middleware-request-${FEATURE_PREVIEW_HEADER}`)).toBe("");
  });

  it("drops unknown flag names and never trusts an inbound preview header", async () => {
    const unknown = await proxy(request("http://test.local/?ff=not-a-flag"));
    expect(unknown.headers.get(`x-middleware-request-${FEATURE_PREVIEW_HEADER}`)).toBe("");

    const spoofed = await proxy(
      request("http://test.local/", { [FEATURE_PREVIEW_HEADER]: "assistantProposals" })
    );
    expect(spoofed.headers.get(`x-middleware-request-${FEATURE_PREVIEW_HEADER}`)).toBeNull();
  });
});
