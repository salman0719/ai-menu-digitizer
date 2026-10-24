import { describe, expect, it, vi } from "vitest";

import {
  AssistantError,
  fetchAssistantUsage,
  sendAssistantMessage,
} from "@/features/assistant/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const usage = {
  cap: 300,
  used: 4,
  remaining: 296,
  periodEnd: "2026-11-01T00:00:00.000Z",
};

describe("sendAssistantMessage", () => {
  it("posts the message and history and returns the validated reply", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ reply: "Open Editor → Preview → Publish.", usage }));

    const reply = await sendAssistantMessage(
      { message: "How do I publish?", history: [{ role: "user", content: "hello" }] },
      fetchImpl
    );

    expect(reply.reply).toContain("Preview");
    expect(reply.usage).toEqual(usage);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/assistant");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      message: "How do I publish?",
      history: [{ role: "user", content: "hello" }],
    });
  });

  it("maps 401 to an unauthorized error with the server message", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "unauthorized", message: "Sign in first." } }, 401)
      );

    const error = await sendAssistantMessage({ message: "hi", history: [] }, fetchImpl).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(AssistantError);
    expect((error as AssistantError).code).toBe("unauthorized");
    expect((error as AssistantError).message).toBe("Sign in first.");
  });

  it("maps 429 to cap_reached and keeps the reset date", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "assistant_cap_reached",
            message: "The allowance resets on 2026-11-01.",
          },
        },
        429
      )
    );

    const error = await sendAssistantMessage({ message: "hi", history: [] }, fetchImpl).catch(
      (caught: unknown) => caught
    );
    expect((error as AssistantError).code).toBe("cap_reached");
    expect((error as AssistantError).message).toContain("2026-11-01");
  });

  it("maps a missing deployment config to not_configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "assistant_not_configured",
            message: "The assistant is not configured on this deployment yet.",
          },
        },
        503
      )
    );

    const error = await sendAssistantMessage({ message: "hi", history: [] }, fetchImpl).catch(
      (caught: unknown) => caught
    );
    expect((error as AssistantError).code).toBe("not_configured");
  });

  it("rejects a reply that does not match the contract", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ reply: "", usage: {} }));

    const error = await sendAssistantMessage({ message: "hi", history: [] }, fetchImpl).catch(
      (caught: unknown) => caught
    );
    expect((error as AssistantError).code).toBe("invalid_response");
  });

  it("reports a network failure as unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline"));

    const error = await sendAssistantMessage({ message: "hi", history: [] }, fetchImpl).catch(
      (caught: unknown) => caught
    );
    expect((error as AssistantError).code).toBe("unavailable");
  });
});

describe("fetchAssistantUsage", () => {
  it("reads the allowance envelope", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ usage }));
    expect(await fetchAssistantUsage(fetchImpl)).toEqual(usage);
  });

  it("maps 401 to unauthorized", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "unauthorized", message: "No." } }, 401)
      );

    const error = await fetchAssistantUsage(fetchImpl).catch((caught: unknown) => caught);
    expect((error as AssistantError).code).toBe("unauthorized");
  });
});
