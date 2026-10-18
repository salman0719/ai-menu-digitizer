import { describe, expect, it, vi } from "vitest";

import { createGeminiProvider } from "../src/lib/ai/gemini-provider";
import { NO_USAGE, ProviderError } from "../src/lib/ai/provider";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successBody(text = '{"title":null,"currency":null,"categories":[]}') {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe("createGeminiProvider", () => {
  it("returns model text on success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successBody('{"ok":true}')));
    const provider = createGeminiProvider({ apiKey: "test-key", fetchImpl });
    await expect(
      provider.generateText({
        promptText: "p",
        images: [{ imageBase64: "AAA", mimeType: "image/png" }],
      })
    ).resolves.toEqual({ text: '{"ok":true}', usage: NO_USAGE });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sends every page as an ordered inlineData part after the prompt", async () => {
    let body: {
      contents: Array<{
        parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      }>;
    } | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return jsonResponse(successBody());
    });
    const provider = createGeminiProvider({ apiKey: "test-key", fetchImpl });
    await provider.generateText({
      promptText: "prompt",
      images: [
        { imageBase64: "AAA", mimeType: "image/png" },
        { imageBase64: "BBB", mimeType: "image/webp" },
      ],
    });
    const parts = body!.contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0].text).toBe("prompt");
    expect(parts[1].inlineData).toEqual({ mimeType: "image/png", data: "AAA" });
    expect(parts[2].inlineData).toEqual({ mimeType: "image/webp", data: "BBB" });
  });

  it("reports token usage, and nulls when the provider omits it", async () => {
    const withUsage = createGeminiProvider({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          ...successBody(),
          usageMetadata: { promptTokenCount: 1234, candidatesTokenCount: 567 },
        })
      ),
    });
    const result = await withUsage.generateText({
      promptText: "p",
      images: [{ imageBase64: "AAA", mimeType: "image/png" }],
    });
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });

    const without = createGeminiProvider({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () => jsonResponse(successBody())),
    });
    const plain = await without.generateText({
      promptText: "p",
      images: [{ imageBase64: "AAA", mimeType: "image/png" }],
    });
    expect(plain.usage).toEqual(NO_USAGE);
  });

  it("rejects a request without any image", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () => jsonResponse(successBody())),
    });
    await expect(provider.generateText({ promptText: "p", images: [] })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("sends the key in a header, never in the URL", async () => {
    let seenUrl = "";
    let seenKey: string | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenKey = new Headers(init?.headers).get("x-goog-api-key");
      return jsonResponse(successBody());
    });
    const provider = createGeminiProvider({ apiKey: "secret-key", fetchImpl });
    await provider.generateText({
      promptText: "p",
      images: [{ imageBase64: "AAA", mimeType: "image/png" }],
    });
    expect(seenUrl).not.toContain("secret-key");
    expect(seenKey).toBe("secret-key");
  });

  it("maps provider failures to coded errors without leaking the key", async () => {
    const cases: Array<{ status: number; code: string }> = [
      { status: 401, code: "auth" },
      { status: 403, code: "auth" },
      { status: 429, code: "quota" },
      { status: 500, code: "unavailable" },
      { status: 400, code: "bad_request" },
    ];
    for (const { status, code } of cases) {
      const provider = createGeminiProvider({
        apiKey: "secret-key",
        fetchImpl: vi.fn(async () => new Response("nope", { status })),
      });
      const error = await provider
        .generateText({ promptText: "p", images: [{ imageBase64: "AAA", mimeType: "image/png" }] })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe(code);
      expect((error as Error).message).not.toContain("secret-key");
    }
  });

  it("treats network failures and blocked content as errors", async () => {
    const offline = createGeminiProvider({
      apiKey: "k",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    const request = {
      promptText: "p",
      images: [{ imageBase64: "AAA", mimeType: "image/png" }],
    };
    await expect(offline.generateText(request)).rejects.toMatchObject({ code: "unavailable" });

    const blocked = createGeminiProvider({
      apiKey: "k",
      fetchImpl: vi.fn(async () => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } })),
    });
    await expect(blocked.generateText(request)).rejects.toMatchObject({ code: "blocked" });

    const empty = createGeminiProvider({
      apiKey: "k",
      fetchImpl: vi.fn(async () => jsonResponse({ candidates: [] })),
    });
    await expect(empty.generateText(request)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses to construct without a key", () => {
    expect(() => createGeminiProvider({ apiKey: "" })).toThrowError(ProviderError);
  });
});
