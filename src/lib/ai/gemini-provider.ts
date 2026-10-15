/**
 * Server-only Gemini provider using the Generative Language REST API.
 * No SDK dependency — plain `fetch`. The API key travels in the
 * `x-goog-api-key` header (never in the URL) and never appears in errors.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/models
 */

import { ExtractionProvider, ExtractionRequest, ProviderError } from "./provider";

/**
 * Default for new projects (overridable via `GEMINI_MODEL`).
 * Flash-Lite is the fastest/most cost-effective choice and the most
 * reliably available; extraction needs speed, not deep reasoning.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extract concatenated text parts from a generateContent response body. */
function extractText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.candidates) || body.candidates.length === 0) {
    return null;
  }
  const content = isRecord(body.candidates[0]) ? body.candidates[0].content : undefined;
  const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
  return text ? text : null;
}

function blockReason(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.promptFeedback)) return null;
  return typeof body.promptFeedback.blockReason === "string"
    ? body.promptFeedback.blockReason
    : null;
}

export function createGeminiProvider(options: GeminiProviderOptions): ExtractionProvider {
  const { apiKey, model = DEFAULT_GEMINI_MODEL, fetchImpl = fetch } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!apiKey) throw new ProviderError("auth", "Gemini API key is missing.");

  return {
    async generateText(request: ExtractionRequest): Promise<string> {
      const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: request.promptText },
                  { inlineData: { mimeType: request.mimeType, data: request.imageBase64 } },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
              maxOutputTokens: 8192,
            },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (fetchError) {
        // Server log only: transport detail contains no keys or bodies.
        console.error(
          `gemini fetch failed: ${fetchError instanceof Error ? `${fetchError.name}: ${fetchError.message}` : String(fetchError)}`
        );
        throw new ProviderError(
          "unavailable",
          "Could not reach the AI provider. Check your connection and try again."
        );
      }

      if (!response.ok) {
        // Server log only: status + model aid debugging without exposing
        // keys, request bodies, or provider internals to the browser.
        console.error(`gemini generateContent failed: model=${model} status=${response.status}`);
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

      const blocked = blockReason(body);
      if (blocked) {
        throw new ProviderError("blocked", "The image could not be processed by the AI provider.");
      }
      const text = extractText(body);
      if (!text) {
        throw new ProviderError("unavailable", "The AI provider returned an empty response.");
      }
      return text;
    },
  };
}
