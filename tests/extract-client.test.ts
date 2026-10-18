import { afterEach, describe, expect, it, vi } from "vitest";

import { ExtractClientError, extractMenuFromFiles } from "../src/lib/extract-client";

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

describe("extractMenuFromFiles", () => {
  it("posts the file and returns the menu", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ menu }));
    const result = await extractMenuFromFiles(testFile(), fetchImpl);
    expect(result).toEqual(menu);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/extract-menu");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("posts every page image under the same field, in order", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ menu }));
    const pages = [testFile(), new File(["bytes2"], "menu-2.png", { type: "image/png" })];
    await extractMenuFromFiles(pages, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const posted = (init.body as FormData).getAll("image");
    expect(posted).toHaveLength(2);
    expect((posted[0] as File).name).toBe("menu.jpg");
    expect((posted[1] as File).name).toBe("menu-2.png");
  });

  it("passes the server's too_many_pages code through as a known code", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: "too_many_pages", message: "Too many pages." } }, 400)
    );
    const error = await extractMenuFromFiles(testFile(), fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractClientError);
    expect(error).toMatchObject({ code: "too_many_pages", message: "Too many pages." });
  });

  it("maps server error codes to typed errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: "quota_exhausted", message: "Slow down." } }, 429)
    );
    const error = await extractMenuFromFiles(testFile(), fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractClientError);
    expect(error).toMatchObject({ code: "quota_exhausted", message: "Slow down." });
  });

  it("falls back to generic errors for unknown shapes", async () => {
    const html = vi.fn(async () => new Response("<html>oops</html>", { status: 500 }));
    const error = await extractMenuFromFiles(testFile(), html).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "internal_error" });

    const wrongShape = vi.fn(async () => jsonResponse({ nope: true }, 400));
    const shapeError = await extractMenuFromFiles(testFile(), wrongShape).catch((e: unknown) => e);
    expect(shapeError).toMatchObject({ code: "internal_error" });

    const missingMenu = vi.fn(async () => jsonResponse({}));
    const menuError = await extractMenuFromFiles(testFile(), missingMenu).catch((e: unknown) => e);
    expect(menuError).toMatchObject({ code: "unexpected_response" });
  });

  it("reports network failures distinctly", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await extractMenuFromFiles(testFile(), offline).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "network_error" });
  });
});
