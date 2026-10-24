/**
 * Server-only Cloudflare Workers AI client for the assistant (A1).
 *
 * Facts this module encodes, all measured in the A0 spike
 * (`local/ai-assistant-rnd/spike-results.json`):
 *
 * - The model is a reasoning model. Without `chat_template_kwargs:
 *   { enable_thinking: false }` the response's `content` stays null while the
 *   token budget is spent on hidden reasoning, so every request disables it.
 * - `/ai/run/<model>` returns an OpenAI-shaped chat completion inside
 *   `result`, including `usage.neurons`. No `model` field in the body.
 * - Output tokens dominate cost (36,400 neurons/M vs 5,500/M input), so the
 *   reply budget stays small and the prompt is trimmed by the caller.
 *
 * Never import this from a client component. The token is read from the
 * server environment and never returned, logged, or echoed in an error.
 */

export const CLOUDFLARE_ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";
export const CLOUDFLARE_API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
export const CLOUDFLARE_MODEL_ENV = "CLOUDFLARE_DEFAULT_AI_MODEL";

export const DEFAULT_ASSISTANT_MODEL = "@cf/zai-org/glm-4.7-flash";

/** The spike's slowest call was 8.7 s; 30 s leaves room without hanging a request. */
export const ASSISTANT_REQUEST_TIMEOUT_MS = 30_000;

/** Replies are short answers, not essays — and output tokens are the expensive ones. */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 800;

/** $0.011 per 1,000 neurons (Workers Paid rate) = 11 micro-USD per neuron. */
export const MICRO_USD_PER_NEURON = 11;

export type AssistantProviderErrorCode =
  | "not_configured"
  | "http_error"
  | "rate_limited"
  | "network_error"
  | "timeout"
  | "invalid_response"
  | "empty_reply";

export class AssistantProviderError extends Error {
  readonly code: AssistantProviderErrorCode;
  readonly status: number | null;

  constructor(code: AssistantProviderErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "AssistantProviderError";
    this.code = code;
    this.status = status;
  }
}

export interface AssistantChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AssistantTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  neurons: number | null;
}

export interface AssistantCompletion {
  text: string;
  model: string;
  usage: AssistantTokenUsage;
  latencyMs: number;
}

export interface CompleteAssistantInput {
  messages: readonly AssistantChatMessage[];
  maxTokens?: number;
  /** Test seam; production uses global fetch. */
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  now?: () => number;
}

export interface AssistantProviderConfig {
  accountId: string;
  token: string;
  model: string;
}

/** Null when any required value is missing — the route says "not configured". */
export function readAssistantProviderConfig(
  env: Record<string, string | undefined> = process.env
): AssistantProviderConfig | null {
  const accountId = env[CLOUDFLARE_ACCOUNT_ID_ENV]?.trim();
  const token = env[CLOUDFLARE_API_TOKEN_ENV]?.trim();
  const model = env[CLOUDFLARE_MODEL_ENV]?.trim() || DEFAULT_ASSISTANT_MODEL;
  if (!accountId || !token) return null;
  return { accountId, token, model };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Extract the answer + metering from either `{ result: … }` or a bare body. */
function readCompletion(body: unknown, model: string, latencyMs: number): AssistantCompletion {
  const root = body as { result?: unknown } | null;
  const result = (root?.result ?? body) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      neurons?: unknown;
    };
  } | null;

  const rawContent = result?.choices?.[0]?.message?.content;
  const text = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!text) {
    throw new AssistantProviderError(
      "empty_reply",
      "Workers AI returned no answer text (reasoning may have consumed the budget)."
    );
  }

  return {
    // Keep the ellipsis inside the 4,000-character contract the response schema
    // enforces; 4,001 characters would fail the browser's Zod parse.
    text: text.length > 4_000 ? `${text.slice(0, 3_999)}…` : text,
    model,
    usage: {
      inputTokens: finiteNumber(result?.usage?.prompt_tokens),
      outputTokens: finiteNumber(result?.usage?.completion_tokens),
      neurons: finiteNumber(result?.usage?.neurons),
    },
    latencyMs,
  };
}

/**
 * One chat completion from Workers AI. Never leaks the provider body, the
 * token, or the account id: errors carry a code and, at most, an HTTP status.
 */
export async function completeAssistantChat(
  input: CompleteAssistantInput
): Promise<AssistantCompletion> {
  const config = readAssistantProviderConfig(input.env);
  if (!config) {
    throw new AssistantProviderError(
      "not_configured",
      "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set."
    );
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => Date.now());
  const started = now();
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/${config.model}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: input.messages,
        max_tokens: input.maxTokens ?? ASSISTANT_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        // Measured: without this the answer is empty and the budget is spent
        // on hidden reasoning. See the A0 results before removing it.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? ASSISTANT_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AssistantProviderError(
      timedOut ? "timeout" : "network_error",
      timedOut ? "Workers AI did not answer in time." : "Could not reach Workers AI."
    );
  }

  const latencyMs = Math.max(0, Math.round(now() - started));

  if (!response.ok) {
    throw new AssistantProviderError(
      response.status === 429 ? "rate_limited" : "http_error",
      `Workers AI answered HTTP ${response.status}.`,
      response.status
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AssistantProviderError(
      "invalid_response",
      "Workers AI returned a body that is not JSON.",
      response.status
    );
  }

  return readCompletion(body, config.model, latencyMs);
}
