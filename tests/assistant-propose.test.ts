import { describe, expect, it, vi } from "vitest";

import { AssistantProviderError } from "@/lib/ai/assistant/worker-ai";
import {
  PROPOSAL_TOOL,
  PROPOSAL_TOOL_NAME,
  parseProposalArguments,
  requestAssistantProposal,
} from "@/lib/ai/assistant/propose";
import type { AssistantChatMessage } from "@/lib/ai/assistant/worker-ai";

/**
 * Transport tests for the proposal tool. `fetch` is the only stub: the real
 * Workers AI client builds the request, so the wire contract (thinking off,
 * forced tool, bounded budget) is asserted here too.
 */

const env = {
  CLOUDFLARE_ACCOUNT_ID: "acct-test",
  CLOUDFLARE_API_TOKEN: "token-test",
  CLOUDFLARE_DEFAULT_AI_MODEL: "@cf/zai-org/glm-4.7-flash",
};

const messages: AssistantChatMessage[] = [
  { role: "system", content: "system" },
  { role: "user", content: "Add a lemonade for 3.50 under Drinks." },
];

const usage = { prompt_tokens: 400, completion_tokens: 40, neurons: 3.2 };

function toolResponse(args: unknown, usageOverride: Record<string, unknown> = usage): Response {
  return new Response(
    JSON.stringify({
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
                    name: PROPOSAL_TOOL_NAME,
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
          },
        ],
        usage: usageOverride,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function textResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      result: {
        choices: [{ message: { role: "assistant", content: text } }],
        usage,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

const validProposal = {
  outcome: "propose",
  message: "Here is the change to review.",
  operations: [
    {
      op: "add_item",
      categoryId: "cat_drinks",
      name: "Lemonade",
      price: 3.5,
    },
  ],
};

describe("proposal tool definition", () => {
  it("is a forced function with the six allowlisted operations", () => {
    expect(PROPOSAL_TOOL.type).toBe("function");
    expect(PROPOSAL_TOOL.function.name).toBe(PROPOSAL_TOOL_NAME);
    const parameters = PROPOSAL_TOOL.function.parameters;
    expect(parameters.required).toEqual(["outcome", "message", "operations"]);
    expect(parameters.additionalProperties).toBe(false);
    expect(parameters.properties.operations.maxItems).toBe(12);

    const variants = parameters.properties.operations.items.oneOf;
    expect(variants).toHaveLength(6);
    expect(variants.map((variant) => variant.properties.op.const).sort()).toEqual([
      "add_category",
      "add_item",
      "move_item",
      "rename_category",
      "set_item_availability",
      "update_item",
    ]);
    const addItem = variants.find((variant) => variant.properties.op.const === "add_item");
    expect(addItem?.required).toContain("categoryId");
    expect(addItem?.additionalProperties).toBe(false);
  });

  it("rejects malformed and unexpected arguments before they can become a proposal", () => {
    expect(parseProposalArguments("not json").ok).toBe(false);
    expect(parseProposalArguments("").ok).toBe(false);

    const extraKey = parseProposalArguments(
      JSON.stringify({ ...validProposal, menuId: "smuggled" })
    );
    expect(extraKey.ok).toBe(false);

    const valid = parseProposalArguments(JSON.stringify(validProposal));
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.args.operations).toHaveLength(1);
  });
});

describe("requestAssistantProposal", () => {
  it("returns valid arguments and sends thinking off, a forced tool and a bounded budget", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(toolResponse(validProposal));
    const result = await requestAssistantProposal({ messages, env, fetchImpl: fetchMock });

    expect(result.invalid).toBe(false);
    expect(result.repaired).toBe(false);
    expect(result.args.outcome).toBe("propose");
    expect(result.args.operations).toHaveLength(1);
    expect(result.usage).toEqual({ inputTokens: 400, outputTokens: 40, neurons: 3.2 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/ai/run/@cf/zai-org/glm-4.7-flash");
    const body = JSON.parse(String((init as RequestInit).body)) as {
      tools: Array<{ function: { name: string } }>;
      tool_choice: { function: { name: string } };
      temperature: number;
      max_tokens: number;
      chat_template_kwargs: Record<string, unknown>;
    };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe(PROPOSAL_TOOL_NAME);
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: PROPOSAL_TOOL_NAME },
    });
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(1_400);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("repairs one invalid response and sums the cost of both calls", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        toolResponse({
          outcome: "propose",
          message: "Missing the category.",
          operations: [{ op: "add_item", name: "Lemonade", price: 3.5 }],
        })
      )
      .mockResolvedValueOnce(
        toolResponse(validProposal, {
          prompt_tokens: 500,
          completion_tokens: 30,
          neurons: 4.1,
        })
      );

    const result = await requestAssistantProposal({ messages, env, fetchImpl: fetchMock });

    expect(result.invalid).toBe(false);
    expect(result.repaired).toBe(true);
    expect(result.usage).toEqual({
      inputTokens: 900,
      outputTokens: 70,
      neurons: 7.3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const correction = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(correction.messages[correction.messages.length - 1].content).toContain(
      "rejected by the server"
    );
    expect(correction.messages[correction.messages.length - 1].content).toContain(
      "do not guess a price"
    );
  });

  it("returns a clarify with no operations when the repair also fails", async () => {
    const bad = () =>
      toolResponse({
        outcome: "propose",
        message: "Bad.",
        operations: [{ op: "add_item", name: "Lemonade", price: 3.5 }],
      });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(bad())
      .mockResolvedValueOnce(bad());

    const result = await requestAssistantProposal({ messages, env, fetchImpl: fetchMock });

    expect(result.invalid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.args.outcome).toBe("clarify");
    expect(result.args.operations).toEqual([]);
    expect(result.args.message).toContain("couldn't turn that into a safe menu change");
    expect(result.usage.inputTokens).toBe(800);
  });

  it("can skip the repair call (used by the route's budget tests)", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      toolResponse({
        outcome: "propose",
        message: "Bad.",
        operations: [{ op: "add_item", name: "No category", price: 1 }],
      })
    );
    const result = await requestAssistantProposal({
      messages,
      env,
      fetchImpl: fetchMock,
      repairs: 0,
    });
    expect(result.invalid).toBe(true);
    expect(result.repaired).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a prose answer without a tool call as a safe answer", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse("I can explain, but I need a menu change."));
    const result = await requestAssistantProposal({ messages, env, fetchImpl: fetchMock });

    expect(result.invalid).toBe(false);
    expect(result.args.outcome).toBe("answer");
    expect(result.args.operations).toEqual([]);
    expect(result.args.message).toContain("I can explain");
  });

  it("propagates a provider failure instead of fabricating a proposal", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream exploded", { status: 500 }));

    const error = await requestAssistantProposal({ messages, env, fetchImpl: fetchMock }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(AssistantProviderError);
    expect((error as AssistantProviderError).code).toBe("http_error");
  });

  it("reports missing configuration without calling the provider", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const error = await requestAssistantProposal({
      messages,
      env: {},
      fetchImpl: fetchMock,
    }).catch((caught: unknown) => caught);
    expect((error as AssistantProviderError).code).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
