/**
 * Server-only Groq provider using the OpenAI-compatible chat-completions API.
 * No SDK dependency — plain `fetch`. The API key travels in the
 * `Authorization: Bearer` header and never appears in errors or logs.
 *
 * Docs: https://console.groq.com/docs/vision
 */

import { logEvent } from "@/lib/observability/log";

import {
  ExtractionProvider,
  ExtractionRequest,
  NO_USAGE,
  ProviderError,
  ProviderResult,
  ProviderUsage,
} from "./provider";

/**
 * Groq's vision model (overridable via `GROQ_MODEL`). Qwen is the generally
 * available vision model; it reads up to three images per request.
 */
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";

/**
 * Groq documents a maximum of three images per vision request. Callers must
 * split larger menus (or route them to a provider without the limit).
 */
export const GROQ_MAX_IMAGES = 3;

const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_COMPLETION_TOKENS = 8192;

export interface GroqProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Correlates provider failures with the request log line. */
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read `choices[0].message.content`; empty or missing means no answer. */
function extractText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || body.choices.length === 0) {
    return null;
  }
  const choice = body.choices[0];
  const message = isRecord(choice) ? choice.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return content.trim() ? content : null;
  // Some models return content as parts rather than a string.
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
    return text.trim() ? text : null;
  }
  return null;
}

/** Read `usage`; missing or non-numeric counts stay null (honest). */
function readUsage(body: unknown): ProviderUsage {
  if (!isRecord(body) || !isRecord(body.usage)) return NO_USAGE;
  const usage = body.usage;
  const read = (key: string): number | null => {
    const value = usage[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.round(value)
      : null;
  };
  return {
    inputTokens: read("prompt_tokens"),
    outputTokens: read("completion_tokens"),
  };
}

export function createGroqProvider(options: GroqProviderOptions): ExtractionProvider {
  const { apiKey, model = DEFAULT_GROQ_MODEL, fetchImpl = fetch, requestId } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!apiKey) throw new ProviderError("auth", "Groq API key is missing.");

  return {
    async generateText(request: ExtractionRequest): Promise<ProviderResult> {
      if (request.images.length === 0) {
        throw new ProviderError("bad_request", "No image was provided for extraction.");
      }
      if (request.images.length > GROQ_MAX_IMAGES) {
        throw new ProviderError(
          "bad_request",
          `Groq reads at most ${GROQ_MAX_IMAGES} page images in one request.`
        );
      }

      let response: Response;
      try {
        response = await fetchImpl(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: request.promptText },
                  // Groq expects a data URL, not a bare base64 string.
                  ...request.images.map((image) => ({
                    type: "image_url",
                    image_url: { url: `data:${image.mimeType};base64,${image.imageBase64}` },
                  })),
                ],
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (fetchError) {
        // Server log only: transport detail contains no keys or bodies.
        logEvent("error", "groq.fetch_failed", { requestId, model, error: fetchError });
        throw new ProviderError(
          "unavailable",
          "Could not reach the AI provider. Check your connection and try again."
        );
      }

      if (!response.ok) {
        // Server log only: status + model aid debugging without exposing
        // keys, request bodies, or provider internals to the browser.
        logEvent("error", "groq.request_failed", { requestId, model, status: response.status });
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError("auth", "The server's AI credentials were rejected.");
        }
        if (response.status === 429) {
          throw new ProviderError(
            "quota",
            "AI quota is exhausted or rate-limited. Wait a while and try again."
          );
        }
        if (response.status >= 500) {
          throw new ProviderError("unavailable", "The AI provider is temporarily unavailable.");
        }
        throw new ProviderError("bad_request", "The AI provider rejected the request.");
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ProviderError("unavailable", "The AI provider returned an unreadable response.");
      }

      const text = extractText(body);
      if (!text) {
        throw new ProviderError("unavailable", "The AI provider returned an empty response.");
      }
      return { text, usage: readUsage(body) };
    },
  };
}
