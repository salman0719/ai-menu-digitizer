/**
 * Minimal provider abstraction so the model/vendor can change later.
 * Server-only — implementations hold API keys and must never be bundled
 * for the browser.
 */

export type ProviderErrorCode =
  /** Invalid key or access denied. */
  | "auth"
  /** Quota exhausted or rate limited. */
  | "quota"
  /** Refused by provider safety/content filters. */
  | "blocked"
  /** Provider rejected the request shape. */
  | "bad_request"
  /** Network failure, timeout, 5xx, or unreadable response. */
  | "unavailable";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export interface ExtractionRequest {
  promptText: string;
  /** Raw image bytes encoded as base64 (no data-URL prefix). */
  imageBase64: string;
  mimeType: string;
}

export interface ExtractionProvider {
  /** Returns the model's raw text output (expected to be JSON). */
  generateText(request: ExtractionRequest): Promise<string>;
}
