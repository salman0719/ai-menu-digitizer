import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../src/app/api/extract-menu/route";

const menuJson = JSON.stringify({
  title: "Route Café",
  currency: "USD",
  categories: [{ name: "Drinks", items: [{ name: "Espresso", price: 3 }] }],
});

/** Real JPEG header bytes, so the server's sniffing passes. */
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];

function form(): FormData {
  const data = new FormData();
  data.append("image", new File([new Uint8Array(JPEG_BYTES)], "menu.jpg", { type: "image/jpeg" }));
  return data;
}

function post(): Promise<Response> {
  return POST(new Request("http://localhost/api/extract-menu", { method: "POST", body: form() }));
}

function geminiSuccess(text = menuJson): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function groqSuccess(text = menuJson): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.GEMINI_API_KEY = "gemini-test-key";
  process.env.GROQ_API_KEY = "groq-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
});

describe("POST /api/extract-menu with two vendors", () => {
  it("serves from Gemini by default and reports the source", async () => {
    const fetchImpl = vi.fn(async () => geminiSuccess());
    vi.stubGlobal("fetch", fetchImpl);

    const response = await post();
    const body = (await response.json()) as { menu: { title: string }; provider: string };
    expect(response.status).toBe(200);
    expect(body.menu.title).toBe("Route Café");
    expect(body.provider).toBe("gemini");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain("generativelanguage");
  });

  it("serves from Groq when AI_PROVIDER=groq", async () => {
    process.env.AI_PROVIDER = "groq";
    process.env.AI_FALLBACK_PROVIDER = "none";
    const fetchImpl = vi.fn(async () => groqSuccess());
    vi.stubGlobal("fetch", fetchImpl);

    const response = await post();
    const body = (await response.json()) as { provider: string; model: string };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("groq");
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.groq.com/openai/v1/chat/completions"
    );
  });

  it("fails over to Groq when Gemini is rate-limited, without leaking the key", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("groq") ? groqSuccess() : new Response("rate limited", { status: 429 })
    );
    vi.stubGlobal("fetch", fetchImpl);

    const response = await post();
    const body = (await response.json()) as { provider: string };
    expect(response.status).toBe(200);
    expect(body.provider).toBe("groq");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toContain("test-key");
  });

  it("reports one plain error when neither vendor succeeds", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await post();
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(response.status).toBe(500);
    expect(body.error.code).toBe("provider_auth_failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(body)).not.toContain("test-key");
  });

  it("reports no configured vendor when both keys are missing", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await post();
    const body = (await response.json()) as { error: { code: string } };
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("missing_api_key");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
