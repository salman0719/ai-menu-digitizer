import { describe, expect, it } from "vitest";

import { isSameOriginRequest, rejectCrossOrigin } from "../src/lib/http/origin";

function request(headers: Record<string, string>): Request {
  return new Request("https://tablepass.example/api/orders", { method: "POST", headers });
}

describe("isSameOriginRequest", () => {
  it("allows requests that carry no Origin (curl, servers, same-origin forms)", () => {
    expect(isSameOriginRequest(request({ host: "tablepass.example" }))).toBe(true);
  });

  it("allows a matching origin, with or without a port", () => {
    expect(
      isSameOriginRequest(
        request({ host: "tablepass.example", origin: "https://tablepass.example" })
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        request({ host: "localhost:3200", origin: "http://localhost:3200" })
      )
    ).toBe(true);
  });

  it("refuses another origin", () => {
    expect(
      isSameOriginRequest(
        request({ host: "tablepass.example", origin: "https://evil.example" })
      )
    ).toBe(false);
    // Same site name, different port is still another origin.
    expect(
      isSameOriginRequest(
        request({ host: "localhost:3200", origin: "http://localhost:9999" })
      )
    ).toBe(false);
  });

  it("refuses opaque origins and malformed Origin values", () => {
    expect(isSameOriginRequest(request({ host: "t.example", origin: "null" }))).toBe(false);
    expect(isSameOriginRequest(request({ host: "t.example", origin: "not a url" }))).toBe(false);
  });

  it("trusts the forwarded host behind a proxy", () => {
    expect(
      isSameOriginRequest(
        request({
          host: "internal:3000",
          "x-forwarded-host": "tablepass.example",
          origin: "https://tablepass.example",
        })
      )
    ).toBe(true);
    expect(
      isSameOriginRequest(
        request({
          host: "internal:3000",
          "x-forwarded-host": "tablepass.example, edge.example",
          origin: "https://tablepass.example",
        })
      )
    ).toBe(true);
  });

  it("refuses a declared cross-site fetch even without an Origin", () => {
    expect(
      isSameOriginRequest(request({ host: "t.example", "sec-fetch-site": "cross-site" }))
    ).toBe(false);
  });
});

describe("rejectCrossOrigin", () => {
  it("returns null for same-origin and a 403 envelope for others", async () => {
    expect(rejectCrossOrigin(request({ host: "t.example", origin: "https://t.example" }))).toBeNull();

    const response = rejectCrossOrigin(
      request({ host: "t.example", origin: "https://evil.example" })
    );
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "cross_origin_rejected",
        message: "This request came from another site.",
      },
    });
  });

  it("guards the anonymous order endpoint before it touches the database", async () => {
    const { POST } = await import("../src/app/api/orders/route");
    const response = await POST(
      new Request("https://tablepass.example/api/orders", {
        method: "POST",
        headers: { host: "tablepass.example", origin: "https://evil.example" },
        body: JSON.stringify({ slug: "x", tableLabel: "1", lines: [] }),
      })
    );
    expect(response.status).toBe(403);
  });
});
