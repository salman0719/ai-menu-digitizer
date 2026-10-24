/**
 * Typed browser client for `/api/assistant` (A1).
 * Client-safe: HTTP + Zod only, no server repo or provider imports.
 */

import { z } from "zod";

import { serverMenuSchema } from "@/features/menus/sync";

import {
  assistantProposalSchema,
  applyProposalRequestSchema,
  proposalPreviewSchema,
  type AssistantOperation,
  type ProposalPreview,
} from "./proposal";
import {
  assistantReplySchema,
  assistantUsageSummarySchema,
  type AssistantHistoryMessage,
  type AssistantUsageSummary,
} from "./schema";

const errorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    currentUpdatedAt: z.string().nullable().optional(),
  }),
});

const usageEnvelope = z.object({ usage: assistantUsageSummarySchema });

/** A help answer, or a proposal the owner can review (A2). */
const assistantTurnSchema = assistantReplySchema.extend({
  outcome: z.enum(["answer", "propose", "clarify", "refuse"]).optional(),
  proposal: assistantProposalSchema.nullable().optional(),
});

export type AssistantTurn = z.infer<typeof assistantTurnSchema>;

export type AssistantClientErrorCode =
  | "unauthorized"
  | "feature_disabled"
  | "cap_reached"
  | "not_configured"
  | "not_found"
  | "unavailable"
  | "invalid_response";

export class AssistantError extends Error {
  readonly code: AssistantClientErrorCode;

  constructor(code: AssistantClientErrorCode, message: string) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** The server's messages are written for owners; use them when present. */
function failureFrom(response: Response, payload: unknown): AssistantError {
  const parsedError = errorEnvelope.safeParse(payload).data?.error;
  const message =
    parsedError?.message ??
    (response.status === 401
      ? "Sign in to use the assistant."
      : "The assistant is unavailable right now. Try again in a moment.");

  if (parsedError?.code === "feature_disabled") {
    return new AssistantError("feature_disabled", message);
  }
  if (response.status === 401) return new AssistantError("unauthorized", message);
  if (response.status === 429) return new AssistantError("cap_reached", message);
  if (response.status === 404) return new AssistantError("not_found", message);
  if (parsedError?.code === "assistant_not_configured") {
    return new AssistantError("not_configured", message);
  }
  return new AssistantError("unavailable", message);
}

/** This account's assistant allowance for the current UTC month. */
export async function fetchAssistantUsage(
  fetchImpl: typeof fetch = fetch
): Promise<AssistantUsageSummary> {
  let response: Response;
  try {
    response = await fetchImpl("/api/assistant", { cache: "no-store" });
  } catch {
    throw new AssistantError("unavailable", "Could not reach the server. Check your connection.");
  }

  const payload = await readJson(response);
  if (!response.ok) throw failureFrom(response, payload);

  try {
    return usageEnvelope.parse(payload).usage;
  } catch {
    throw new AssistantError(
      "invalid_response",
      "The server sent allowance data this app could not understand."
    );
  }
}

/**
 * One chat turn. `history` is the conversation so far, oldest first. Passing
 * `menuId` lets an owner receive a proposal; omitting it keeps the A1 help
 * behaviour exactly as it was.
 */
export async function sendAssistantMessage(
  input: { message: string; history: readonly AssistantHistoryMessage[]; menuId?: string },
  fetchImpl: typeof fetch = fetch
): Promise<AssistantTurn> {
  let response: Response;
  try {
    response = await fetchImpl("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        history: input.history,
        ...(input.menuId ? { menuId: input.menuId } : {}),
      }),
      cache: "no-store",
    });
  } catch {
    throw new AssistantError("unavailable", "Could not reach the server. Check your connection.");
  }

  const payload = await readJson(response);
  if (!response.ok) throw failureFrom(response, payload);

  try {
    return assistantTurnSchema.parse(payload);
  } catch {
    throw new AssistantError(
      "invalid_response",
      "The assistant sent a reply this app could not understand. Try again."
    );
  }
}

/* ------------------------------------------------------------------ */
/* Approval (A2)                                                       */
/* ------------------------------------------------------------------ */

export type AssistantApplyErrorCode =
  | "unauthorized"
  | "feature_disabled"
  | "forbidden"
  | "not_found"
  | "stale"
  | "invalid"
  | "unavailable"
  | "invalid_response";

export class AssistantApplyError extends Error {
  readonly code: AssistantApplyErrorCode;
  /** For `stale`: the server's current revision, for an explicit re-preview. */
  readonly currentUpdatedAt: string | null;

  constructor(
    code: AssistantApplyErrorCode,
    message: string,
    currentUpdatedAt: string | null = null
  ) {
    super(message);
    this.name = "AssistantApplyError";
    this.code = code;
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

const applyResponseSchema = z.object({
  menu: serverMenuSchema,
  preview: proposalPreviewSchema,
});

export interface ApplyProposalInput {
  menuId: string;
  expectedUpdatedAt: string;
  operations: readonly AssistantOperation[];
}

export interface ApplyProposalResult {
  menu: z.infer<typeof serverMenuSchema>;
  preview: ProposalPreview;
}

/**
 * Approve a previewed proposal. The operations are re-validated by the server;
 * a 409 means the menu moved and the owner must review a fresh proposal.
 */
export async function applyAssistantProposal(
  input: ApplyProposalInput,
  fetchImpl: typeof fetch = fetch
): Promise<ApplyProposalResult> {
  const parsedBody = applyProposalRequestSchema.safeParse({
    menuId: input.menuId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    operations: input.operations,
  });
  if (!parsedBody.success) {
    throw new AssistantApplyError(
      "invalid",
      parsedBody.error.issues[0]?.message ?? "That change is not valid for this menu."
    );
  }

  let response: Response;
  try {
    response = await fetchImpl("/api/assistant/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsedBody.data),
      cache: "no-store",
    });
  } catch {
    throw new AssistantApplyError(
      "unavailable",
      "Could not reach the server. Check your connection."
    );
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const parsedError = errorEnvelope.safeParse(payload).data?.error;
    const message =
      parsedError?.message ?? "The change could not be applied. Try again in a moment.";
    if (parsedError?.code === "feature_disabled") {
      throw new AssistantApplyError("feature_disabled", message);
    }
    if (response.status === 401) throw new AssistantApplyError("unauthorized", message);
    if (response.status === 403) throw new AssistantApplyError("forbidden", message);
    if (response.status === 404) throw new AssistantApplyError("not_found", message);
    if (response.status === 409) {
      throw new AssistantApplyError("stale", message, parsedError?.currentUpdatedAt ?? null);
    }
    if (response.status === 400) throw new AssistantApplyError("invalid", message);
    throw new AssistantApplyError("unavailable", message);
  }

  try {
    return applyResponseSchema.parse(payload);
  } catch {
    throw new AssistantApplyError(
      "invalid_response",
      "The server sent menu data this app could not understand. Reload and try again."
    );
  }
}
