/**
 * Typed browser client for `/api/assistant` (A1).
 * Client-safe: HTTP + Zod only, no server repo or provider imports.
 */

import { z } from "zod";

import {
  assistantReplySchema,
  assistantUsageSummarySchema,
  type AssistantHistoryMessage,
  type AssistantReply,
  type AssistantUsageSummary,
} from "./schema";

const errorEnvelope = z.object({
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }),
});

const usageEnvelope = z.object({ usage: assistantUsageSummarySchema });

export type AssistantClientErrorCode =
  "unauthorized" | "cap_reached" | "not_configured" | "unavailable" | "invalid_response";

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

  if (response.status === 401) return new AssistantError("unauthorized", message);
  if (response.status === 429) return new AssistantError("cap_reached", message);
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

/** One chat turn. `history` is the conversation so far, oldest first. */
export async function sendAssistantMessage(
  input: { message: string; history: readonly AssistantHistoryMessage[] },
  fetchImpl: typeof fetch = fetch
): Promise<AssistantReply> {
  let response: Response;
  try {
    response = await fetchImpl("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.message, history: input.history }),
      cache: "no-store",
    });
  } catch {
    throw new AssistantError("unavailable", "Could not reach the server. Check your connection.");
  }

  const payload = await readJson(response);
  if (!response.ok) throw failureFrom(response, payload);

  try {
    return assistantReplySchema.parse(payload);
  } catch {
    throw new AssistantError(
      "invalid_response",
      "The assistant sent a reply this app could not understand. Try again."
    );
  }
}
