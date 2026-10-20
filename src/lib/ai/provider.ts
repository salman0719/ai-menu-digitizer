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

export interface ImagePart {
  /** Raw image bytes encoded as base64 (no data-URL prefix). */
  imageBase64: string;
  mimeType: string;
}

export interface ExtractionRequest {
  promptText: string;
  /** Menu page images in reading order; one entry for a single-page menu. */
  images: ImagePart[];
}

/**
 * Token accounting as reported by the provider. Either side can be null when
 * the provider did not tell us — a cost built on half the data would be a
 * made-up number.
 */
export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProviderResult {
  /** The model's raw text output (expected to be JSON). */
  text: string;
  usage: ProviderUsage;
}

export const NO_USAGE: ProviderUsage = { inputTokens: null, outputTokens: null };

/** Sum two usage records; null wins only when *both* sides are null. */
export function addUsage(a: ProviderUsage, b: ProviderUsage): ProviderUsage {
  const sum = (left: number | null, right: number | null): number | null => {
    if (left === null) return right;
    if (right === null) return left;
    return left + right;
  };
  return { inputTokens: sum(a.inputTokens, b.inputTokens), outputTokens: sum(a.outputTokens, b.outputTokens) };
}

export interface ExtractionProvider {
  generateText(request: ExtractionRequest): Promise<ProviderResult>;
}

/** The image-extraction vendors this app can talk to. */
export type ProviderName = "gemini" | "groq";

/**
 * Which provider/model actually produced an extraction. Recorded with the
 * menu and the usage ledger, so "gemini" is never written over a Groq result.
 */
export interface ProviderIdentity {
  provider: ProviderName;
  model: string;
}
