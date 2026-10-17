/**
 * Extraction orchestration: validate the upload, call the provider,
 * validate the AI JSON, and attempt one controlled repair retry.
 * Server-only. Throws {@link ServiceError} with HTTP-ready status/code.
 */

import {
  detectImageMimeType,
  MAX_IMAGE_BYTES,
  MAX_MENU_PAGES,
  MAX_TOTAL_IMAGE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ProviderImageMimeType,
  type SupportedImageMimeType,
} from "../image-constraints";
import { ExtractedMenu, extractedMenuSchema } from "./extraction-schema";
import { buildExtractionPrompt, buildRepairPrompt } from "./prompts";
import { ExtractionProvider, ProviderError } from "./provider";

export { MAX_IMAGE_BYTES, MAX_MENU_PAGES, MAX_TOTAL_IMAGE_BYTES, SUPPORTED_IMAGE_MIME_TYPES };

const MAX_REPAIR_INPUT_CHARS = 8000;

export type ServiceErrorCode =
  | "missing_image"
  | "invalid_file_type"
  | "file_too_large"
  | "empty_file"
  | "too_many_pages"
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
  /** Declared type; the real bytes win when they carry a recognisable header. */
  mimeType: string;
  filename?: string;
}

interface NormalizedImage {
  bytes: Uint8Array;
  mimeType: ProviderImageMimeType;
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

/**
 * Validate a batch of page images (count, per-file type/size, total size) and
 * return them with sniffed MIME types. Runs before any provider call; throws
 * {@link ServiceError}.
 */
function validateImages(images: ImageInput[]): NormalizedImage[] {
  if (images.length === 0) {
    throw new ServiceError(400, "missing_image", "Upload an image file in the `image` field.");
  }
  if (images.length > MAX_MENU_PAGES) {
    throw new ServiceError(
      400,
      "too_many_pages",
      `Too many pages in one request (max ${MAX_MENU_PAGES} page images).`
    );
  }
  let totalBytes = 0;
  const normalized: NormalizedImage[] = [];
  for (const input of images) {
    // Prefer the real header over the declared type: browsers and camera
    // exports mislabel files (AVIF under .jpg, HEIC with an empty type).
    const sniffed = detectImageMimeType(input.bytes);
    const declared = SUPPORTED_IMAGE_MIME_TYPES.includes(
      input.mimeType as SupportedImageMimeType
    )
      ? (input.mimeType as SupportedImageMimeType)
      : null;
    const mimeType = sniffed ?? declared;
    if (!mimeType) {
      throw new ServiceError(
        400,
        "invalid_file_type",
        `Unsupported image type. Use one of: ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}.`
      );
    }
    if (mimeType === "image/avif") {
      throw new ServiceError(
        400,
        "invalid_file_type",
        "AVIF images can't be read by the AI provider directly. Re-upload it through the app so it can be converted to JPEG first."
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
    totalBytes += input.bytes.length;
    normalized.push({
      bytes: input.bytes,
      mimeType: mimeType as ProviderImageMimeType,
      filename: input.filename,
    });
  }
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new ServiceError(
      413,
      "file_too_large",
      `The page images are too large in total (max ${MAX_TOTAL_IMAGE_BYTES / (1024 * 1024)} MB for all pages together).`
    );
  }
  return normalized;
}

/**
 * Extract one menu from one or more page images in a single provider call,
 * so a menu that spans pages comes back merged (categories continue across
 * pages instead of being extracted twice).
 */
export async function extractMenuFromImages(
  images: ImageInput[],
  deps: ServiceDeps
): Promise<ExtractedMenu> {
  const normalized = validateImages(images);
  if (!deps.provider) {
    throw new ServiceError(
      503,
      "missing_api_key",
      "AI extraction is not configured on this server (missing API key)."
    );
  }

  const parts = normalized.map((input) => ({
    imageBase64: Buffer.from(input.bytes).toString("base64"),
    mimeType: input.mimeType,
  }));
  try {
    const first = await deps.provider.generateText({
      promptText: buildExtractionPrompt(images.length),
      images: parts,
    });
    const menu = parseMenu(first);
    if (menu) return menu;

    // One controlled repair retry, then give up with a useful error.
    const repair = await deps.provider.generateText({
      promptText: buildRepairPrompt(first.slice(0, MAX_REPAIR_INPUT_CHARS), describeIssues(first)),
      images: parts,
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
