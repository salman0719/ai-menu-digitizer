/**
 * Extraction orchestration: validate the upload, call the provider,
 * validate the AI JSON, and attempt one controlled repair retry.
 * Server-only. Throws {@link ServiceError} with HTTP-ready status/code.
 */

import { ExtractedMenu, extractedMenuSchema } from "./extraction-schema";
import { buildExtractionPrompt, buildRepairPrompt } from "./prompts";
import { ExtractionProvider, ProviderError } from "./provider";

export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// Vercel's Hobby plan rejects request bodies above ~4.5 MB before our code
// runs, so validate well below that and document the limit in errors.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MAX_REPAIR_INPUT_CHARS = 8000;

export type ServiceErrorCode =
  | "missing_image"
  | "invalid_file_type"
  | "file_too_large"
  | "empty_file"
  | "missing_api_key"
  | "provider_auth_failed"
  | "quota_exhausted"
  | "content_blocked"
  | "provider_unavailable"
  | "invalid_ai_response";

export class ServiceError extends Error {
  readonly status: number;
  readonly code: ServiceErrorCode;

  constructor(status: number, code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
}

export interface ImageInput {
  bytes: Uint8Array;
  mimeType: string;
  filename?: string;
}

export interface ServiceDeps {
  /** Null when no API key is configured — extraction is unavailable. */
  provider: ExtractionProvider | null;
}

function parseMenu(rawText: string): ExtractedMenu | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  const result = extractedMenuSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function describeIssues(rawText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return ["Response was not valid JSON."];
  }
  const result = extractedMenuSchema.safeParse(parsed);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

function mapProviderError(error: ProviderError): ServiceError {
  switch (error.code) {
    case "auth":
      return new ServiceError(
        500,
        "provider_auth_failed",
        "The server's AI credentials are invalid. Check GEMINI_API_KEY."
      );
    case "quota":
      return new ServiceError(
        429,
        "quota_exhausted",
        "AI quota is exhausted. Wait a while and try again."
      );
    case "blocked":
      return new ServiceError(
        502,
        "content_blocked",
        "The image could not be processed. Try a clearer photo of the menu."
      );
    default:
      return new ServiceError(
        502,
        "provider_unavailable",
        "The AI provider is unavailable. Try again in a moment."
      );
  }
}

export async function extractMenuFromImage(
  input: ImageInput,
  deps: ServiceDeps
): Promise<ExtractedMenu> {
  if (
    !SUPPORTED_IMAGE_MIME_TYPES.includes(
      input.mimeType as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]
    )
  ) {
    throw new ServiceError(
      400,
      "invalid_file_type",
      `Unsupported image type. Use one of: ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}.`
    );
  }
  if (input.bytes.length === 0) {
    throw new ServiceError(400, "empty_file", "The uploaded image is empty.");
  }
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    throw new ServiceError(
      413,
      "file_too_large",
      `Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`
    );
  }
  if (!deps.provider) {
    throw new ServiceError(
      503,
      "missing_api_key",
      "AI extraction is not configured on this server (missing API key)."
    );
  }

  const imageBase64 = Buffer.from(input.bytes).toString("base64");
  try {
    const first = await deps.provider.generateText({
      promptText: buildExtractionPrompt(),
      imageBase64,
      mimeType: input.mimeType,
    });
    const menu = parseMenu(first);
    if (menu) return menu;

    // One controlled repair retry, then give up with a useful error.
    const repair = await deps.provider.generateText({
      promptText: buildRepairPrompt(first.slice(0, MAX_REPAIR_INPUT_CHARS), describeIssues(first)),
      imageBase64,
      mimeType: input.mimeType,
    });
    const repaired = parseMenu(repair);
    if (repaired) return repaired;
    throw new ServiceError(
      502,
      "invalid_ai_response",
      "The AI returned data in an unexpected format. Try again or use a clearer image."
    );
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof ProviderError) throw mapProviderError(error);
    throw error;
  }
}
