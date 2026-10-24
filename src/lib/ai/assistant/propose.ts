/**
 * The proposal tool and its transport (A2).
 *
 * The A0 spike proved the pattern on this model: force one function call
 * (`tool_choice`), validate its arguments with Zod, and retry once with the
 * validation errors if the model returns an unusable shape. Reasoning is
 * disabled for every call, exactly like the help path.
 *
 * Two things this module deliberately does NOT do:
 * - it does not touch menus or the database (the route dry-runs the proposal
 *   against the real document before returning it),
 * - it does not trust a tool call because the model made it. Arguments are
 *   still validated here, and again by `applyProposalOperations` at approval
 *   time.
 *
 * Server-only by convention.
 */

import {
  ASSISTANT_MAX_OPERATIONS,
  ASSISTANT_MAX_PROPOSAL_MESSAGE,
  type AssistantProposalArguments,
  assistantProposalArgumentsSchema,
} from "@/features/assistant/proposal";

import {
  completeAssistantChat,
  type AssistantChatMessage,
  type AssistantCompletion,
  type AssistantTokenUsage,
} from "./worker-ai";

export const PROPOSAL_TOOL_NAME = "propose_menu_change";

/** Proposals are short JSON; 1,400 tokens is the A0 working budget. */
export const PROPOSAL_MAX_OUTPUT_TOKENS = 1_400;

/** Lower than the help path: structured edits should not be creative. */
export const PROPOSAL_TEMPERATURE = 0.1;

const categoryIdDescription =
  "Exact category id from <menu-data>, or the name of a category added earlier in this proposal.";

const operationVariants = [
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "categoryId", "name", "price"],
    properties: {
      op: { const: "add_item" },
      categoryId: { type: "string", minLength: 1, description: categoryIdDescription },
      name: { type: "string", minLength: 1, maxLength: 120 },
      price: { type: "number", minimum: 0, description: "The price the owner stated. Required." },
      description: { type: ["string", "null"], maxLength: 2_000 },
      available: { type: "boolean" },
      dietaryLabels: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 40 },
        maxItems: 12,
      },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "itemId"],
    properties: {
      op: { const: "update_item" },
      itemId: { type: "string", minLength: 1, description: "Exact item id from <menu-data>." },
      name: { type: "string", minLength: 1, maxLength: 120 },
      description: { type: ["string", "null"], maxLength: 2_000 },
      price: { type: "number", minimum: 0 },
      available: { type: "boolean" },
      dietaryLabels: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 40 },
        maxItems: 12,
      },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "itemId", "available"],
    properties: {
      op: { const: "set_item_availability" },
      itemId: { type: "string", minLength: 1 },
      available: { type: "boolean" },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "name"],
    properties: {
      op: { const: "add_category" },
      name: { type: "string", minLength: 1, maxLength: 120 },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "categoryId", "name"],
    properties: {
      op: { const: "rename_category" },
      categoryId: { type: "string", minLength: 1, description: categoryIdDescription },
      name: { type: "string", minLength: 1, maxLength: 120 },
    },
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["op", "itemId", "toCategoryId"],
    properties: {
      op: { const: "move_item" },
      itemId: { type: "string", minLength: 1, description: "Exact item id from <menu-data>." },
      toCategoryId: { type: "string", minLength: 1, description: categoryIdDescription },
    },
  },
] as const;

/**
 * OpenAI-shaped function definition. `llm-4.7-flash` honours this through the
 * Workers AI `/ai/run/<model>` route (verified in the A0 spike), so no second
 * endpoint or SDK is needed.
 */
export const PROPOSAL_TOOL = {
  type: "function",
  function: {
    name: PROPOSAL_TOOL_NAME,
    description:
      "Answer the owner, ask a clarifying question, refuse, or propose menu operations for review. Never invent prices, ids or features. Changes are applied only after the owner approves them.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["outcome", "message", "operations"],
      properties: {
        outcome: {
          type: "string",
          enum: ["answer", "propose", "clarify", "refuse"],
          description:
            "propose only for a concrete allowlisted change; clarify when a fact (usually the price) is missing; refuse for features that do not exist.",
        },
        message: {
          type: "string",
          minLength: 1,
          maxLength: ASSISTANT_MAX_PROPOSAL_MESSAGE,
          description: "What the owner reads. Do not claim the change was applied.",
        },
        question: {
          type: ["string", "null"],
          maxLength: 500,
          description: "The clarifying question when outcome is clarify.",
        },
        operations: {
          type: "array",
          maxItems: ASSISTANT_MAX_OPERATIONS,
          items: { oneOf: operationVariants },
        },
      },
    },
  },
} as const;

export interface RequestProposalInput {
  messages: readonly AssistantChatMessage[];
  /** Test seams, identical to the help path. */
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  now?: () => number;
  /** 1 by default (the scope's "one repair retry"); tests pass 0. */
  repairs?: number;
}

export interface ProposalResult {
  args: AssistantProposalArguments;
  /** True when the model never produced schema-valid arguments. */
  invalid: boolean;
  /** True when the second (repair) call was used. */
  repaired: boolean;
  model: string;
  usage: AssistantTokenUsage;
  latencyMs: number;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

function sumUsage(first: AssistantTokenUsage, second: AssistantTokenUsage): AssistantTokenUsage {
  return {
    inputTokens: sumNullable(first.inputTokens, second.inputTokens),
    outputTokens: sumNullable(first.outputTokens, second.outputTokens),
    neurons: sumNullable(first.neurons, second.neurons),
  };
}

function issueSummary(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  const text = error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "proposal"}: ${issue.message}`)
    .join("; ");
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}

type ParseResult = { ok: true; args: AssistantProposalArguments } | { ok: false; reason: string };

/** Decode the tool-call arguments (a JSON string) and validate the shape. */
export function parseProposalArguments(raw: string | null | undefined): ParseResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "the tool call had no arguments" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "the arguments were not JSON" };
  }
  const parsed = assistantProposalArgumentsSchema.safeParse(decoded);
  if (!parsed.success) return { ok: false, reason: issueSummary(parsed.error) };
  return { ok: true, args: parsed.data };
}

/** The first call: force the tool and validate what comes back. */
function readProposal(
  completion: AssistantCompletion
): { kind: "args"; args: AssistantProposalArguments } | { kind: "invalid"; reason: string } {
  const call = completion.toolCalls.find((candidate) => candidate.name === PROPOSAL_TOOL_NAME);
  if (!call) {
    // `tool_choice` should make this impossible. If the model answered in
    // prose anyway, that answer is safe to show (it cannot write anything).
    if (completion.text) {
      return {
        kind: "args",
        args: {
          outcome: "answer",
          message: completion.text.slice(0, ASSISTANT_MAX_PROPOSAL_MESSAGE),
          operations: [],
        },
      };
    }
    return { kind: "invalid", reason: "the model did not call propose_menu_change" };
  }

  const parsed = parseProposalArguments(call.arguments);
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };
  return { kind: "args", args: parsed.args };
}

/**
 * Ask the model for one proposal. A schema failure costs one corrective call;
 * if that also fails, the caller gets a `clarify` with no operations and the
 * knowledge that the attempt was invalid (for logging/metering), never a
 * half-applied edit.
 */
export async function requestAssistantProposal(
  input: RequestProposalInput
): Promise<ProposalResult> {
  const call = (messages: readonly AssistantChatMessage[]) =>
    completeAssistantChat({
      messages,
      tools: [PROPOSAL_TOOL],
      toolChoice: { type: "function", function: { name: PROPOSAL_TOOL_NAME } },
      maxTokens: PROPOSAL_MAX_OUTPUT_TOKENS,
      temperature: PROPOSAL_TEMPERATURE,
      fetchImpl: input.fetchImpl,
      env: input.env,
      timeoutMs: input.timeoutMs,
      now: input.now,
    });

  const first = await call(input.messages);
  const firstRead = readProposal(first);
  if (firstRead.kind === "args") {
    return {
      args: firstRead.args,
      invalid: false,
      repaired: false,
      model: first.model,
      usage: first.usage,
      latencyMs: first.latencyMs,
    };
  }

  const repairs = input.repairs ?? 1;
  if (repairs < 1) {
    return invalidResult(first, null, false);
  }

  const firstCall = first.toolCalls.find((candidate) => candidate.name === PROPOSAL_TOOL_NAME);
  const correction: AssistantChatMessage[] = [
    ...input.messages,
    {
      role: "user",
      content: [
        firstCall?.arguments
          ? `Your previous propose_menu_change arguments were: ${firstCall.arguments.slice(0, 1_200)}`
          : "Your previous response did not call propose_menu_change.",
        `That was rejected by the server (${firstRead.reason}).`,
        `Call ${PROPOSAL_TOOL_NAME} again with arguments that satisfy the schema.`,
        "Do not add operations the owner did not ask for, and do not guess a price.",
      ].join("\n"),
    },
  ];

  const second = await call(correction);
  const secondRead = readProposal(second);
  if (secondRead.kind === "args") {
    return {
      args: secondRead.args,
      invalid: false,
      repaired: true,
      model: second.model,
      usage: sumUsage(first.usage, second.usage),
      latencyMs: first.latencyMs + second.latencyMs,
    };
  }

  return invalidResult(second, first, true);
}

function invalidResult(
  completion: AssistantCompletion,
  first: AssistantCompletion | null,
  repaired: boolean
): ProposalResult {
  return {
    args: {
      outcome: "clarify",
      message:
        "I couldn't turn that into a safe menu change. Try naming the item and the exact change — for example “change the chicken burger to 13.00”.",
      operations: [],
    },
    invalid: true,
    repaired,
    model: completion.model,
    usage: first ? sumUsage(first.usage, completion.usage) : completion.usage,
    latencyMs: (first?.latencyMs ?? 0) + completion.latencyMs,
  };
}
