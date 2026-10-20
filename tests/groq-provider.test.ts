import { describe, expect, it, vi } from "vitest";

import {
  createGroqProvider,
  DEFAULT_GROQ_MODEL,
  GROQ_MAX_IMAGES,
} from "../src/lib/ai/groq-provider";
import { NO_USAGE, ProviderError } from "../src/lib/ai/provider";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successBody(text = '{"title":null,"currency":null,"categories":[]}') {
  return { choices: [{ message: { role: "assistant", content: text } }] };
}

function image(mimeType = "image/jpeg", imageBase64 = "AAA") {
  return { imageBase64, mimeType };
}

describe("createGroqProvider", () => {
  it("returns model text on success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successBody('{"ok":true}')));
    const provider = createGroqProvider({ apiKey: "test-key", fetchImpl });
    await expect(provider.generateText({ promptText: "p", images: [image()] })).resolves.toEqual({
      text: '{"ok":true}',
      usage: NO_USAGE,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("posts an OpenAI-compatible vision request with data URLs", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fetchImpl = vi.fn(
      async (requestUrl: string | URL | Request, requestInit?: RequestInit) => {
        url = String(requestUrl);
        init = requestInit;
        return jsonResponse(successBody());
      }
    );
    const provider = createGroqProvider({ apiKey: "test-key", fetchImpl });
    await provider.generateText({
      promptText: "prompt",
      images: [image("image/jpeg", "AAA"), image("image/png", "BBB")],
    });

    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
      response_format: { type: string };
    };
    expect(body.model).toBe(DEFAULT_GROQ_MODEL);
    expect(body.response_format).toEqual({ type: "json_object" });
    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: "text", text: "prompt" });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,AAA" },
    });
    expect(content[2]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,BBB" },
    });
  });

  it("reports token usage, and nulls when the provider omits it", async () => {
    const withUsage = createGroqProvider({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () =>
        jsonResponse({ ...successBody(), usage: { prompt_tokens: 1234, completion_tokens: 567 } })
      ),
    });
    const result = await withUsage.generateText({ promptText: "p", images: [image()] });
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });

    const without = createGroqProvider({
      apiKey: "test-key",
      fetchImpl: vi.fn(async () => jsonResponse(successBody())),
    });
    const plain = await without.generateText({ promptText: "p", images: [image()] });
    expect(plain.usage).toEqual(NO_USAGE);
  });

  it("refuses more images than Groq's per-request limit, without calling the API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successBody()));
    const provider = createGroqProvider({ apiKey: "test-key", fetchImpl });
    await expect(
      provider.generateText({
        promptText: "p",
        images: Array.from({ length: GROQ_MAX_IMAGES + 1 }, () => image()),
      })
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(provider.generateText({ promptText: "p", images: [] })).rejects.toMatchObject({
      code: "bad_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the key in a header, never in the URL", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return jsonResponse(successBody());
    });
    const provider = createGroqProvider({ apiKey: "secret-key", fetchImpl });
    await provider.generateText({ promptText: "p", images: [image()] });
    expect(seenUrl).not.toContain("secret-key");
    expect(JSON.stringify(seenInit?.body)).not.toContain("secret-key");
    expect(new Headers(seenInit?.headers).get("Authorization")).toBe("Bearer secret-key");
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
      const provider = createGroqProvider({
        apiKey: "secret-key",
        fetchImpl: vi.fn(async () => new Response("nope", { status })),
      });
      const error = await provider
        .generateText({ promptText: "p", images: [image()] })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe(code);
      expect((error as Error).message).not.toContain("secret-key");
    }
  });

  it("treats network failures and empty responses as unavailable", async () => {
    const request = { promptText: "p", images: [image()] };
    const offline = createGroqProvider({
      apiKey: "k",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(offline.generateText(request)).rejects.toMatchObject({ code: "unavailable" });

    const empty = createGroqProvider({
      apiKey: "k",
      fetchImpl: vi.fn(async () => jsonResponse({ choices: [] })),
    });
    await expect(empty.generateText(request)).rejects.toMatchObject({ code: "unavailable" });

    const unreadable = createGroqProvider({
      apiKey: "k",
      fetchImpl: vi.fn(async () => new Response("not json", { status: 200 })),
    });
    await expect(unreadable.generateText(request)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses to construct without a key", () => {
    expect(() => createGroqProvider({ apiKey: "" })).toThrowError(ProviderError);
  });
});
