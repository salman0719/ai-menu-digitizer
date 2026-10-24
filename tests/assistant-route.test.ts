import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/assistant/route";
import { recordAssistantUsage } from "@/features/assistant/repo";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { createMenuForUser } from "@/features/menus/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { assistantUsage } from "@/lib/db/schema";
import type { TestDb } from "./helpers/pg-test-db";

/**
 * HTTP-surface tests for /api/assistant (A1). Real handlers, real generated
 * DDL (PGlite), with only the session and the provider's `fetch` stubbed —
 * so auth, the cost brakes, prompt assembly, ledger accounting and error
 * mapping are exercised through Request/Response objects.
 *
 * The provider stub also lets us assert the wire contract the A0 spike found:
 * thinking disabled, a bounded output budget, and the model in the URL.
 */

const holder: { db: TestDb | null; userId: string | null } = {
  db: null,
  userId: null,
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUserId: vi.fn(async () => holder.userId),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not initialised");
    return holder.db;
  },
}));

const fetchMock = vi.fn<typeof fetch>();

const ENV_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_DEFAULT_AI_MODEL",
  "ASSISTANT_MONTHLY_MESSAGE_CAP",
  "ASSISTANT_DAILY_CALL_CEILING",
  "RESEND_API_KEY",
] as const;
const originalEnv: Record<string, string | undefined> = {};

async function initTestDb(): Promise<TestDb> {
  const { createTestDb } = await import("./helpers/pg-test-db");
  const { db } = await createTestDb();
  return db;
}

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chatResponse(text: string | null, usage?: Record<string, unknown>): Response {
  return providerResponse({
    result: {
      choices: [{ message: { role: "assistant", content: text } }],
      usage: usage ?? { prompt_tokens: 486, completion_tokens: 80, neurons: 5.3 },
    },
  });
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://test.local/api/assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "test.local",
      "x-request-id": "req-assistant-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function seedUser(email = "owner@cafe.test"): Promise<string> {
  const { seedUser: seed } = await import("./helpers/pg-test-db");
  return seed(holder.db!, email, "Owner");
}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
  process.env.CLOUDFLARE_API_TOKEN = "token-test";
  process.env.CLOUDFLARE_DEFAULT_AI_MODEL = "@cf/zai-org/glm-4.7-flash";

  holder.db = await initTestDb();
  holder.userId = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("POST /api/assistant", () => {
  it("returns 401 when signed out, before any provider call", async () => {
    const response = await POST(request({ message: "How do I publish?" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: expect.any(String) },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request", async () => {
    holder.userId = await seedUser();
    const response = await POST(
      request({ message: "How do I publish?" }, { origin: "https://evil.example" })
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("cross_origin_rejected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty message with 400", async () => {
    holder.userId = await seedUser();
    const response = await POST(request({ message: "   " }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers, meters the call and never caches the reply", async () => {
    holder.userId = await seedUser();
    fetchMock.mockResolvedValueOnce(
      chatResponse("Open the menu, then **Editor → Preview → Publish**.")
    );

    const response = await POST(request({ message: "How do I publish my menu?" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.reply).toContain("Editor → Preview → Publish");
    expect(payload.usage).toEqual({
      cap: 300,
      used: 1,
      remaining: 299,
      periodEnd: expect.any(String),
    });

    const rows = await holder.db!.select().from(assistantUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "succeeded",
      requestId: "req-assistant-1",
      inputTokens: 486,
      outputTokens: 80,
      costMicros: 58,
    });
    expect(rows[0].neurons).toBeCloseTo(5.3, 5);
  });

  it("sends thinking disabled, a bounded budget and the account context", async () => {
    const userId = await seedUser();
    holder.userId = userId;
    const { id: restaurantId } = await createRestaurant(holder.db!, userId, "Bistro Four");
    await createMenuForUser(holder.db!, userId, restaurantId, createSampleMenuDocument());
    fetchMock.mockResolvedValueOnce(chatResponse("Here is how."));

    const response = await POST(request({ message: "How do I publish my menu?" }));
    expect(response.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/ai/run/@cf/zai-org/glm-4.7-flash");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer token-test",
    });
    const body = JSON.parse(String((init as RequestInit).body)) as {
      messages: { role: string; content: string }[];
      max_tokens: number;
      chat_template_kwargs: Record<string, unknown>;
    };
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.max_tokens).toBe(800);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("Bistro Four (owner)");
    expect(body.messages[0].content).toContain("Editor → Preview");
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: "user",
      content: "How do I publish my menu?",
    });
    // The provider request must never carry a browser-supplied instruction
    // that the system prompt did not also see.
    expect(body.messages).toHaveLength(2);
  });

  it("returns 429 when the monthly cap is reached, without calling the provider", async () => {
    process.env.ASSISTANT_MONTHLY_MESSAGE_CAP = "1";
    const userId = await seedUser();
    holder.userId = userId;
    await recordAssistantUsage(holder.db!, {
      userId,
      requestId: "seed",
      model: "m",
      inputTokens: null,
      outputTokens: null,
      neurons: null,
      latencyMs: null,
      status: "succeeded",
    });

    const response = await POST(request({ message: "One more?" }));
    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.error.code).toBe("assistant_cap_reached");
    expect(payload.error.message).toContain("resets on");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the shared daily ceiling is reached", async () => {
    process.env.ASSISTANT_DAILY_CALL_CEILING = "1";
    const userId = await seedUser();
    holder.userId = userId;
    await recordAssistantUsage(holder.db!, {
      userId,
      requestId: "seed",
      model: "m",
      inputTokens: null,
      outputTokens: null,
      neurons: null,
      latencyMs: null,
      status: "failed",
      errorCode: "http_error",
    });

    const response = await POST(request({ message: "Hello?" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("assistant_budget_exhausted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates an overlong answer inside the response contract", async () => {
    holder.userId = await seedUser();
    fetchMock.mockResolvedValueOnce(chatResponse("a".repeat(5_000)));

    const response = await POST(request({ message: "Tell me everything." }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reply).toHaveLength(4_000);
    expect(payload.reply.endsWith("…")).toBe(true);
  });

  it("maps a provider failure to a generic 503 and records the attempt", async () => {
    holder.userId = await seedUser();
    fetchMock.mockResolvedValueOnce(
      new Response("upstream balance exhausted: account acct-test", { status: 500 })
    );

    const response = await POST(request({ message: "How do I publish?" }));
    expect(response.status).toBe(503);
    const raw = JSON.stringify(await response.json());
    expect(raw).not.toContain("balance");
    expect(raw).not.toContain("acct-test");
    expect(JSON.parse(raw).error.code).toBe("assistant_unavailable");

    const rows = await holder.db!.select().from(assistantUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "http_error" });
  });

  it("treats an empty model answer as a failure, not an empty reply", async () => {
    holder.userId = await seedUser();
    fetchMock.mockResolvedValueOnce(chatResponse(null));

    const response = await POST(request({ message: "How do I publish?" }));
    expect(response.status).toBe(503);
    const rows = await holder.db!.select().from(assistantUsage);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "empty_reply" });
  });

  it("says the assistant is not configured when the token is missing", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    holder.userId = await seedUser();

    const response = await POST(request({ message: "How do I publish?" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("assistant_not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a provider rate limit to the busy message", async () => {
    holder.userId = await seedUser();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));

    const response = await POST(request({ message: "How do I publish?" }));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe("assistant_unavailable");
    expect(payload.error.message).toContain("busy");
  });
});

describe("GET /api/assistant", () => {
  it("returns 401 when signed out", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("reports the allowance without spending anything", async () => {
    holder.userId = await seedUser();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      usage: { cap: 300, used: 0, remaining: 300, periodEnd: expect.any(String) },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await holder.db!.select().from(assistantUsage)).toHaveLength(0);
  });
});
