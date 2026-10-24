import { describe, expect, it, vi } from "vitest";

import {
  AssistantApplyError,
  AssistantError,
  applyAssistantProposal,
  fetchAssistantUsage,
  sendAssistantMessage,
} from "@/features/assistant/client";
import { createSampleMenuDocument } from "@/features/menu/sample-menu";

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

describe("sendAssistantMessage with a menu", () => {
  it("sends the menu id and parses a proposal", async () => {
    const doc = { ...createSampleMenuDocument(), id: "menu-1", title: "Lunch" };
    const proposal = {
      menuId: "menu-1",
      outcome: "propose" as const,
      operations: [{ op: "add_category" as const, name: "Desserts" }],
      basedOnUpdatedAt: "2026-10-24T10:00:00.000Z",
      preview: {
        before: { title: "Lunch", categories: 2, items: 4 },
        after: { title: "Lunch", categories: 3, items: 4 },
        operations: [
          {
            op: "add_category" as const,
            summary: 'Add category "Desserts"',
            changes: [{ label: "Category", before: null, after: "Desserts" }],
          },
        ],
        warnings: ["This changes your draft only."],
      },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ outcome: "propose", reply: "Review this.", usage, proposal })
      );

    const turn = await sendAssistantMessage(
      { message: "Add desserts", history: [], menuId: "menu-1" },
      fetchImpl
    );

    expect(turn.outcome).toBe("propose");
    expect(turn.proposal?.operations).toHaveLength(1);
    expect(turn.proposal?.preview.after.categories).toBe(3);
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual({
      message: "Add desserts",
      history: [],
      menuId: "menu-1",
    });
    expect(doc.id).toBe("menu-1");
  });

  it("maps a menu that vanished to not_found", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "not_found", message: "That menu does not exist." } }, 404)
      );
    const error = await sendAssistantMessage(
      { message: "hi", history: [], menuId: "gone" },
      fetchImpl
    ).catch((caught: unknown) => caught);
    expect((error as AssistantError).code).toBe("not_found");
  });
});

describe("applyAssistantProposal", () => {
  const doc = { ...createSampleMenuDocument(), id: "menu-1", title: "Lunch" };
  const menu = {
    id: "menu-1",
    restaurantId: "restaurant-1",
    restaurantName: "Sunny Side Café",
    title: "Lunch",
    currency: "USD",
    availability: [],
    createdAt: "2026-10-24T09:00:00.000Z",
    updatedAt: "2026-10-24T10:00:00.000Z",
    doc,
  };
  const preview = {
    before: { title: "Lunch", categories: 2, items: 4 },
    after: { title: "Lunch", categories: 3, items: 4 },
    operations: [
      {
        op: "add_category" as const,
        summary: 'Add category "Desserts"',
        changes: [{ label: "Category", before: null, after: "Desserts" }],
      },
    ],
    warnings: ["This changes your draft only."],
  };

  it("posts the previewed operations and returns the saved menu", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ menu, preview }));

    const result = await applyAssistantProposal(
      {
        menuId: "menu-1",
        expectedUpdatedAt: "2026-10-24T10:00:00.000Z",
        operations: [{ op: "add_category", name: "Desserts" }],
      },
      fetchImpl
    );

    expect(result.menu.id).toBe("menu-1");
    expect(result.preview.after.categories).toBe(3);
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual({
      menuId: "menu-1",
      expectedUpdatedAt: "2026-10-24T10:00:00.000Z",
      operations: [{ op: "add_category", name: "Desserts" }],
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/assistant/apply");
  });

  it("maps 409 to stale with the server's current revision", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "stale_menu",
            message: "This menu changed.",
            currentUpdatedAt: "2026-10-24T11:00:00.000Z",
          },
        },
        409
      )
    );

    const error = await applyAssistantProposal(
      {
        menuId: "menu-1",
        expectedUpdatedAt: "2026-10-24T10:00:00.000Z",
        operations: [{ op: "add_category", name: "Desserts" }],
      },
      fetchImpl
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AssistantApplyError);
    expect((error as AssistantApplyError).code).toBe("stale");
    expect((error as AssistantApplyError).currentUpdatedAt).toBe("2026-10-24T11:00:00.000Z");
  });

  it("maps 403 to forbidden and a bad body to invalid", async () => {
    const forbidden = await applyAssistantProposal(
      {
        menuId: "menu-1",
        expectedUpdatedAt: "x",
        operations: [{ op: "add_category", name: "Desserts" }],
      },
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "forbidden", message: "Owner only." } }, 403)
        )
    ).catch((caught: unknown) => caught);
    expect((forbidden as AssistantApplyError).code).toBe("forbidden");

    const invalid = await applyAssistantProposal(
      {
        menuId: "menu-1",
        expectedUpdatedAt: "x",
        operations: [{ op: "add_category", name: "Desserts" }],
      },
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ error: { code: "invalid_operations", message: "Nope." } }, 400)
        )
    ).catch((caught: unknown) => caught);
    expect((invalid as AssistantApplyError).code).toBe("invalid");
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
