/**
 * Shared upload constraints. Client-safe (no Node APIs) — imported by both
 * the upload UI (for instant feedback) and the API route (for enforcement).
 * Keep the two in sync by always importing from here.
 */

export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

/**
 * Types the AI provider accepts directly. Gemini documents HEIC/HEIF but not
 * AVIF, so AVIF is converted to JPEG in the browser before upload (see
 * `prepare-image.ts`).
 */
export const PROVIDER_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type ProviderImageMimeType = (typeof PROVIDER_IMAGE_MIME_TYPES)[number];

/** Extension fallback for browsers that report an empty `File.type`. */
const EXTENSION_MIME_TYPES: Record<string, SupportedImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

export function mimeTypeFromFileName(name: string | undefined): SupportedImageMimeType | null {
  if (!name) return null;
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(EXTENSION_MIME_TYPES, extension)
    ? EXTENSION_MIME_TYPES[extension]
    : null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Identify an image from its leading bytes. Extensions and `File.type` lie
 * (a real sample shipped AVIF bytes under a `.jpg` name), so upload handling
 * prefers this over the declared type. Returns null when the header is not
 * recognised.
 */
export function detectImageMimeType(bytes: Uint8Array): SupportedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  // ISO base media files (AVIF/HEIC/HEIF) carry an `ftyp` box at offset 4.
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)) {
      return "image/heic";
    }
    if (brand === "mif1" || brand === "msf1" || brand === "heif") return "image/heif";
  }
  return null;
}

export type ImageByteDecision =
  | { action: "pass"; mimeType: ProviderImageMimeType }
  | { action: "transcode"; mimeType: "image/avif" }
  | { action: "unsupported"; mimeType: null };

/**
 * Decide how a picked file should be sent, based on its real bytes first and
 * its declared type/extension only when the header is unknown. AVIF is
 * transcoded because the provider does not accept it.
 */
export function classifyImageBytes(
  bytes: Uint8Array,
  declaredType: string | undefined,
  fileName?: string
): ImageByteDecision {
  const detected = detectImageMimeType(bytes);
  const declared = (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(declaredType ?? "")
    ? (declaredType as SupportedImageMimeType)
    : null;
  const mimeType = detected ?? declared ?? mimeTypeFromFileName(fileName);
  if (!mimeType) return { action: "unsupported", mimeType: null };
  if (mimeType === "image/avif") return { action: "transcode", mimeType: "image/avif" };
  return { action: "pass", mimeType };
}

// Vercel's Hobby plan rejects request bodies above ~4.5 MB before our code
// runs, so validate well below that and document the limit in errors.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Maximum number of page images sent in one extraction request. */
export const MAX_MENU_PAGES = 4;

/**
 * Upper bound for the combined size of all page images in one request.
 * The per-file limit alone cannot bound a multi-page upload, and the whole
 * multipart body must stay under Vercel's limit, so pages share one budget.
 */
export const MAX_TOTAL_IMAGE_BYTES = MAX_IMAGE_BYTES;

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** Minimal shape needed for validation — satisfied by `File` and test doubles. */
export interface FileLike {
  type: string;
  size: number;
  name?: string;
}

export type FileValidationErrorCode = "invalid_file_type" | "file_too_large" | "empty_file";

export type BatchValidationErrorCode = FileValidationErrorCode | "too_many_pages";

/**
 * Validate a whole batch of page images: at least one, no more than
 * {@link MAX_MENU_PAGES}, each file valid, and all files together within
 * {@link MAX_TOTAL_IMAGE_BYTES}. The server re-checks all of this — use it
 * only for instant feedback before uploading.
 */
export function validateImageBatch(
  files: readonly FileLike[]
): { valid: true } | { valid: false; code: BatchValidationErrorCode; message: string } {
  if (files.length === 0) {
    return { valid: false, code: "empty_file", message: "Choose at least one image." };
  }
  if (files.length > MAX_MENU_PAGES) {
    return {
      valid: false,
      code: "too_many_pages",
      message: `Too many pages — a menu can have up to ${MAX_MENU_PAGES} page images.`,
    };
  }
  for (const file of files) {
    const check = validateImageFile(file);
    if (!check.valid) return check;
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
    return {
      valid: false,
      code: "file_too_large",
      message: `The ${files.length === 1 ? "image is" : "pages are"} too large together (${formatFileSize(totalBytes)}). Max ${formatFileSize(MAX_TOTAL_IMAGE_BYTES)} in total.`,
    };
  }
  return { valid: true };
}

export function validateImageFile(
  file: FileLike
): { valid: true } | { valid: false; code: FileValidationErrorCode; message: string } {
  const declared = (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)
    ? file.type
    : mimeTypeFromFileName(file.name);
  if (!declared) {
    return {
      valid: false,
      code: "invalid_file_type",
      message: `Unsupported image type. Use one of: ${SUPPORTED_IMAGE_MIME_TYPES.join(", ")}.`,
    };
  }
  if (file.size === 0) {
    return { valid: false, code: "empty_file", message: "The selected image is empty." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      code: "file_too_large",
      message: `Image is too large (${formatFileSize(file.size)}). Max ${formatFileSize(MAX_IMAGE_BYTES)}.`,
    };
  }
  return { valid: true };
}
