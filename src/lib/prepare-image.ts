/**
 * Browser-side image preparation for upload. Client-only — uses canvas, so
 * never import this from server code.
 *
 * Why this exists: the provider accepts JPEG/PNG/WebP/HEIC/HEIF but not AVIF,
 * and `File.type` cannot be trusted (a real sample was AVIF bytes under a
 * `.jpg` name). We sniff the leading bytes and transcode AVIF to JPEG. HEIC
 * passes through unchanged because Gemini reads it natively; browsers other
 * than Safari cannot decode it, so re-encoding it here would fail.
 */

import {
  classifyImageBytes,
  type ProviderImageMimeType,
  type SupportedImageMimeType,
} from "./image-constraints";

/** Sniffed bytes needed to identify every supported header. */
const HEADER_BYTES = 32;

/** JPEG quality for transcoded AVIF input: high enough for small menu text. */
const TRANSCODE_QUALITY = 0.92;

export interface PreparedImage {
  blob: Blob;
  mimeType: ProviderImageMimeType;
  /** File name to report back; transcoded images gain a `.jpg` extension. */
  filename: string;
}

export class PrepareImageError extends Error {
  readonly code: "unsupported" | "decode_failed";

  constructor(code: "unsupported" | "decode_failed", message: string) {
    super(message);
    this.name = "PrepareImageError";
    this.code = code;
  }
}

export async function readImageHeader(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
}

function replaceExtension(name: string, extension: string): string {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${base || "menu"}.${extension}`;
}

function extensionFor(mimeType: SupportedImageMimeType): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/avif":
      return "avif";
  }
}

async function transcodeToJpeg(blob: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new PrepareImageError(
      "decode_failed",
      "This AVIF image could not be decoded in your browser. Re-save it as JPEG and try again."
    );
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new PrepareImageError("decode_failed", "Your browser could not prepare this image.");
    }
    context.drawImage(bitmap, 0, 0);
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", TRANSCODE_QUALITY)
    );
    if (!jpeg) {
      throw new PrepareImageError("decode_failed", "Your browser could not prepare this image.");
    }
    return jpeg;
  } finally {
    bitmap.close();
  }
}

/**
 * Turn a picked file into bytes the extraction API can read: AVIF becomes
 * JPEG, everything else passes through with its sniffed MIME type. Throws
 * {@link PrepareImageError} for unknown formats or failed AVIF decoding.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  const header = await readImageHeader(file);
  const decision = classifyImageBytes(header, file.type, file.name);

  if (decision.action === "unsupported") {
    throw new PrepareImageError(
      "unsupported",
      "Unsupported image type. Use JPEG, PNG, WebP, AVIF, or HEIC."
    );
  }

  if (decision.action === "transcode") {
    const jpeg = await transcodeToJpeg(file);
    return {
      blob: jpeg,
      mimeType: "image/jpeg",
      filename: replaceExtension(file.name, "jpg"),
    };
  }

  // Re-wrap only when the declared type disagrees with the real bytes, so the
  // server and provider see the honest MIME type.
  const blob =
    file.type === decision.mimeType
      ? file
      : new Blob([file], { type: decision.mimeType });
  const filename =
    (file.name || "menu").split(".").pop()!.toLowerCase() ===
    extensionFor(decision.mimeType)
      ? file.name
      : replaceExtension(file.name, extensionFor(decision.mimeType));
  return { blob, mimeType: decision.mimeType, filename };
}
