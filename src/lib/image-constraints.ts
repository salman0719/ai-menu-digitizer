/**
 * Shared upload constraints. Client-safe (no Node APIs) — imported by both
 * the upload UI (for instant feedback) and the API route (for enforcement).
 * Keep the two in sync by always importing from here.
 */

export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

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
  if (!(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
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
