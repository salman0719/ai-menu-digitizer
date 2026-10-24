import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/assistant/route";
import { recordAssistantUsage } from "@/features/assistant/repo";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";
import { createMenuForUser, getMenuForUser, type ServerMenu } from "@/features/menus/repo";
import { createRestaurant } from "@/features/tenancy/repo";
import { assistantUsage, restaurantMembership } from "@/lib/db/schema";
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

function toolResponse(args: unknown, usage?: Record<string, unknown>): Response {
  return providerResponse({
    result: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "propose_menu_change",
                  arguments: JSON.stringify(args),
                },
              },
            ],
          },
        },
      ],
      usage: usage ?? { prompt_tokens: 900, completion_tokens: 60, neurons: 8.1 },
    },
  });
}

async function seedMenu(
  userId: string
): Promise<{ menu: ServerMenu; restaurantId: string; drinksId: string }> {
  const { id: restaurantId } = await createRestaurant(holder.db!, userId, "Bistro Four");
  const menu = await createMenuForUser(
    holder.db!,
    userId,
    restaurantId,
    createSampleMenuDocument()
  );
  const drinks = menu.doc.categories.find((category) => category.name === "Espresso & Coffee");
  if (!drinks) throw new Error("fixture menu has no drinks category");
  return { menu, restaurantId, drinksId: drinks.id };
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

describe("POST /api/assistant with a menu", () => {
  it("returns a server-computed proposal to the owner without writing", async () => {
    const userId = await seedUser();
    holder.userId = userId;
    const { menu, drinksId } = await seedMenu(userId);
    fetchMock.mockResolvedValueOnce(
      toolResponse({
        outcome: "propose",
        message: "Review this change.",
        operations: [{ op: "add_item", categoryId: drinksId, name: "Lemonade", price: 3.5 }],
      })
    );

    const response = await POST(
      request({ message: "Add a lemonade for 3.50 under drinks.", menuId: menu.id })
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.outcome).toBe("propose");
    expect(payload.reply).toBe("Review this change.");
    expect(payload.proposal).toMatchObject({
      menuId: menu.id,
      basedOnUpdatedAt: menu.updatedAt,
      currency: "USD",
    });
    expect(payload.proposal.operations).toHaveLength(1);
    expect(payload.proposal.preview.before).toMatchObject({ categories: 2, items: 4 });
    expect(payload.proposal.preview.after).toMatchObject({ categories: 2, items: 5 });
    expect(payload.usage).toMatchObject({ cap: 300, used: 1, remaining: 299 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/ai/run/@cf/zai-org/glm-4.7-flash");
    const body = JSON.parse(String((init as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ function: { name: string } }>;
      tool_choice: { function: { name: string } };
      temperature: number;
      max_tokens: number;
      chat_template_kwargs: Record<string, unknown>;
    };
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice.function.name).toBe("propose_menu_change");
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(1_400);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.messages[0].content).toContain("<menu-data>");
    expect(body.messages[0].content).toContain(menu.id);
    expect(body.messages[0].content).toContain(drinksId);

    const rows = await holder.db!.select().from(assistantUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "succeeded", requestId: "req-assistant-1" });

    // Preview only: the menu row has not moved.
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.updatedAt).toBe(menu.updatedAt);
    expect(
      stored.doc.categories
        .flatMap((category) => category.items)
        .some((item) => item.name === "Lemonade")
    ).toBe(false);
  });

  it("keeps staff on the help surface, with no tool and no proposal", async () => {
    const ownerId = await seedUser();
    const { menu, restaurantId } = await seedMenu(ownerId);
    const staffId = await seedUser("staff@cafe.test");
    await holder.db!.insert(restaurantMembership).values({
      restaurantId,
      userId: staffId,
      role: "staff",
    });
    holder.userId = staffId;
    fetchMock.mockResolvedValueOnce(chatResponse("Open the menu from My menus."));

    const response = await POST(request({ message: "How do I edit this menu?", menuId: menu.id }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.reply).toContain("My menus");
    expect(payload.proposal).toBeUndefined();
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      tools?: unknown;
      messages: Array<{ content: string }>;
    };
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content).not.toContain("<menu-data>");
  });

  it("404s a menu from another tenant before spending a token", async () => {
    const ownerId = await seedUser();
    const { menu } = await seedMenu(ownerId);
    holder.userId = await seedUser("stranger@cafe.test");

    const response = await POST(request({ message: "Add tea.", menuId: menu.id }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the missing price instead of proposing a null one", async () => {
    const userId = await seedUser();
    holder.userId = userId;
    const { menu, drinksId } = await seedMenu(userId);
    fetchMock.mockResolvedValueOnce(
      toolResponse({
        outcome: "propose",
        message: "Adding it now.",
        operations: [
          { op: "add_item", categoryId: drinksId, name: "Mystery lemonade", price: null },
        ],
      })
    );

    const response = await POST(request({ message: "Add a mystery lemonade.", menuId: menu.id }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.outcome).toBe("clarify");
    expect(payload.proposal).toBeUndefined();
    expect(payload.reply).toContain("What price");
    const rows = await holder.db!.select().from(assistantUsage);
    expect(rows[0]).toMatchObject({ status: "succeeded" });
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.updatedAt).toBe(menu.updatedAt);
  });

  it("turns an invented category id into a question, not a write", async () => {
    const userId = await seedUser();
    holder.userId = userId;
    const { menu } = await seedMenu(userId);
    fetchMock.mockResolvedValueOnce(
      toolResponse({
        outcome: "propose",
        message: "Added to desserts.",
        operations: [{ op: "add_item", categoryId: "cat_desserts", name: "Tiramisu", price: 9 }],
      })
    );

    const response = await POST(request({ message: "Add tiramisu.", menuId: menu.id }));
    const payload = await response.json();
    expect(payload.outcome).toBe("clarify");
    expect(payload.proposal).toBeUndefined();
    expect(payload.reply).toContain("category");
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.updatedAt).toBe(menu.updatedAt);
  });

  it("clarifies and records a failed attempt when both model calls are invalid", async () => {
    const userId = await seedUser();
    holder.userId = userId;
    const { menu } = await seedMenu(userId);
    const bad = () =>
      toolResponse({
        outcome: "propose",
        message: "Bad.",
        operations: [{ op: "add_item", name: "No category", price: 1 }],
      });
    fetchMock.mockResolvedValueOnce(bad()).mockResolvedValueOnce(bad());

    const response = await POST(request({ message: "Add something.", menuId: menu.id }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.outcome).toBe("clarify");
    expect(payload.proposal).toBeUndefined();
    expect(payload.reply).toContain("safe menu change");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const rows = await holder.db!.select().from(assistantUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "invalid_proposal" });
  });

  it("drops operations attached to an answer or refusal", async () => {
    const userId = await seedUser();
    holder.userId = userId;
    const { menu } = await seedMenu(userId);
    fetchMock.mockResolvedValueOnce(
      toolResponse({
        outcome: "answer",
        message: "You can rename a category in the editor.",
        operations: [{ op: "add_category", name: "Not approved" }],
      })
    );

    const response = await POST(request({ message: "How do I rename?", menuId: menu.id }));
    const payload = await response.json();
    expect(payload.outcome).toBe("answer");
    expect(payload.proposal).toBeUndefined();
    const stored = await getMenuForUser(holder.db!, userId, menu.id);
    expect(stored.doc.categories.map((category) => category.name)).not.toContain("Not approved");
  });
});
