import { afterEach, describe, expect, it, vi } from "vitest";

import { ExtractClientError, extractMenuFromFile } from "../src/lib/extract-client";

const menu = { title: "T", currency: null, categories: [] };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function testFile(): File {
  return new File(["bytes"], "menu.jpg", { type: "image/jpeg" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractMenuFromFile", () => {
  it("posts the file and returns the menu", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ menu }));
    const result = await extractMenuFromFile(testFile(), fetchImpl);
    expect(result).toEqual(menu);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/extract-menu");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("maps server error codes to typed errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: "quota_exhausted", message: "Slow down." } }, 429)
    );
    const error = await extractMenuFromFile(testFile(), fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractClientError);
    expect(error).toMatchObject({ code: "quota_exhausted", message: "Slow down." });
  });

  it("falls back to generic errors for unknown shapes", async () => {
    const html = vi.fn(async () => new Response("<html>oops</html>", { status: 500 }));
    const error = await extractMenuFromFile(testFile(), html).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "internal_error" });

    const wrongShape = vi.fn(async () => jsonResponse({ nope: true }, 400));
    const shapeError = await extractMenuFromFile(testFile(), wrongShape).catch((e: unknown) => e);
    expect(shapeError).toMatchObject({ code: "internal_error" });

    const missingMenu = vi.fn(async () => jsonResponse({}));
    const menuError = await extractMenuFromFile(testFile(), missingMenu).catch((e: unknown) => e);
    expect(menuError).toMatchObject({ code: "unexpected_response" });
  });

  it("reports network failures distinctly", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await extractMenuFromFile(testFile(), offline).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "network_error" });
  });
});
