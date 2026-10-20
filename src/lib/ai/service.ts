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
import { logEvent } from "../observability/log";
import { ExtractedMenu, extractedMenuSchema } from "./extraction-schema";
import { buildExtractionPrompt, buildRepairPrompt } from "./prompts";
import type { ProviderSlot } from "./provider-config";
import {
  addUsage,
  NO_USAGE,
  ProviderError,
  ProviderName,
  ProviderUsage,
} from "./provider";

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
  /**
   * Tokens the provider already billed for before this failure, when known.
   * A failed extraction is still a paid API call, so the cost brake counts it.
   */
  readonly usage: ProviderUsage | null;
  /** Vendor that failed last, when the failure happened at a provider. */
  readonly provider: ProviderName | null;
  readonly model: string | null;

  constructor(
    status: number,
    code: ServiceErrorCode,
    message: string,
    usage: ProviderUsage | null = null,
    provider: ProviderName | null = null,
    model: string | null = null
  ) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    this.usage = usage;
    this.provider = provider;
    this.model = model;
  }
}

/** A successful extraction plus what it cost the provider account. */
export interface ExtractionOutcome {
  menu: ExtractedMenu;
  /** Summed across every attempt, including one that failed over. */
  usage: ProviderUsage;
  /** Which vendor and model actually produced this menu. */
  provider: ProviderName;
  model: string;
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
  /**
   * Configured vendors in the order to try them. Empty when no API key is
   * configured — extraction is unavailable. See `buildProviderChain`.
   */
  chain: ProviderSlot[];
  /** Correlates fallback log lines with the request log. */
  requestId?: string;
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

function mapProviderError(error: ProviderError, slot: ProviderSlot): ServiceError {
  const keyName = slot.name === "gemini" ? "GEMINI_API_KEY" : "GROQ_API_KEY";
  switch (error.code) {
    case "auth":
      return new ServiceError(
        500,
        "provider_auth_failed",
        `The server's AI credentials are invalid. Check ${keyName}.`
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
 * Vendors that can read this exact upload. A vendor is skipped when it has
 * a hard page limit below the upload's page count or cannot read one of the
 * image types; it is never sent an image it cannot read.
 */
function eligibleSlots(chain: ProviderSlot[], images: NormalizedImage[]): ProviderSlot[] {
  return chain.filter(
    (slot) =>
      images.length <= slot.maxImages &&
      images.every((image) => slot.supportedMimeTypes.includes(image.mimeType))
  );
}

/** Explain why no configured vendor can read this upload. */
function unsupportedForChain(
  chain: ProviderSlot[],
  images: NormalizedImage[]
): ServiceError {
  const pageLimit = Math.max(...chain.map((slot) => slot.maxImages));
  if (images.length > pageLimit) {
    return new ServiceError(
      400,
      "too_many_pages",
      `This menu has ${images.length} pages, but the configured AI provider reads at most ${pageLimit} per extraction. Send fewer pages or split the menu into two scans.`
    );
  }
  const types = [...new Set(images.map((image) => image.mimeType))].join(", ");
  return new ServiceError(
    400,
    "invalid_file_type",
    `The configured AI provider can't read these page images (${types}). Re-upload them as JPEG or PNG.`
  );
}

/**
 * One vendor's full attempt: first call, then a single controlled repair
 * retry when the JSON does not validate. Throws {@link ServiceError} or
 * {@link ProviderError}.
 */
async function extractWithSlot(
  slot: ProviderSlot,
  parts: Array<{ imageBase64: string; mimeType: ProviderImageMimeType }>,
  pageCount: number,
  track: (usage: ProviderUsage) => void
): Promise<ExtractedMenu> {
  const first = await slot.provider.generateText({
    promptText: buildExtractionPrompt(pageCount),
    images: parts,
  });
  track(first.usage);
  const menu = parseMenu(first.text);
  if (menu) return menu;

  const repair = await slot.provider.generateText({
    promptText: buildRepairPrompt(
      first.text.slice(0, MAX_REPAIR_INPUT_CHARS),
      describeIssues(first.text)
    ),
    images: parts,
  });
  track(repair.usage);
  const repaired = parseMenu(repair.text);
  if (repaired) return repaired;
  throw new ServiceError(
    502,
    "invalid_ai_response",
    "The AI returned data in an unexpected format. Try again or use a clearer image."
  );
}

/** Provider failures that another vendor can plausibly recover from. */
const FALLBACK_PROVIDER_CODES = new Set<ProviderError["code"]>([
  "auth",
  "quota",
  "unavailable",
]);

/**
 * Extract one menu from one or more page images, so a menu that spans pages
 * comes back merged (categories continue across pages instead of being
 * extracted twice).
 *
 * The configured vendors are tried in order: a vendor that is rate-limited,
 * unauthorized, unreachable, or unable to produce valid JSON hands over to
 * the next one. Upload validation, content blocks, and capability limits are
 * final — retrying those on another vendor would not change the answer.
 */
export async function extractMenuFromImages(
  images: ImageInput[],
  deps: ServiceDeps
): Promise<ExtractionOutcome> {
  const normalized = validateImages(images);
  if (deps.chain.length === 0) {
    throw new ServiceError(
      503,
      "missing_api_key",
      "AI extraction isn't available right now. You can still explore with demo data."
    );
  }

  const eligible = eligibleSlots(deps.chain, normalized);
  if (eligible.length === 0) {
    throw unsupportedForChain(deps.chain, normalized);
  }

  const parts = normalized.map((input) => ({
    imageBase64: Buffer.from(input.bytes).toString("base64"),
    mimeType: input.mimeType,
  }));

  // Token usage accumulates across calls so the recorded cost reflects every
  // billed request, including a repair retry or a failed-over attempt.
  let usage: ProviderUsage = NO_USAGE;
  const track = (next: ProviderUsage): void => {
    usage = addUsage(usage, next);
  };

  let lastError: ServiceError | null = null;
  for (let index = 0; index < eligible.length; index += 1) {
    const slot = eligible[index];
    try {
      const menu = await extractWithSlot(slot, parts, images.length, track);
      return { menu, usage, provider: slot.name, model: slot.model };
    } catch (error) {
      const mapped =
        error instanceof ServiceError
          ? error
          : error instanceof ProviderError
            ? mapProviderError(error, slot)
            : null;
      if (!mapped) throw error;

      lastError = new ServiceError(
        mapped.status,
        mapped.code,
        mapped.message,
        usage,
        slot.name,
        slot.model
      );
      const retryable =
        mapped.code === "invalid_ai_response" ||
        (error instanceof ProviderError && FALLBACK_PROVIDER_CODES.has(error.code));
      const next = eligible[index + 1];
      if (!retryable || !next) break;

      logEvent("warn", "ai.provider_fallback", {
        requestId: deps.requestId,
        from: slot.name,
        to: next.name,
        code: mapped.code,
      });
    }
  }

  throw (
    lastError ??
    new ServiceError(
      502,
      "provider_unavailable",
      "The AI provider is unavailable. Try again in a moment."
    )
  );
}
