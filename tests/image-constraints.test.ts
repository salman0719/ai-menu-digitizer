import { describe, expect, it } from "vitest";

import {
  classifyImageBytes,
  detectImageMimeType,
  formatFileSize,
  MAX_IMAGE_BYTES,
  MAX_MENU_PAGES,
  MAX_TOTAL_IMAGE_BYTES,
  mimeTypeFromFileName,
  validateImageBatch,
  validateImageFile,
} from "../src/lib/image-constraints";

describe("validateImageFile", () => {
  it("accepts supported types within the size limit", () => {
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/heic",
      "image/heif",
    ]) {
      expect(validateImageFile({ type, size: 1024 })).toEqual({ valid: true });
    }
  });

  it("falls back to the file extension when the browser reports no type", () => {
    expect(validateImageFile({ type: "", size: 1024, name: "menu.HEIC" })).toEqual({ valid: true });
    expect(validateImageFile({ type: "", size: 1024, name: "notes.txt" }).valid).toBe(false);
  });

  it("rejects unsupported types, empty files, and oversized files", () => {
    expect(validateImageFile({ type: "image/gif", size: 1024 }).valid).toBe(false);
    expect(validateImageFile({ type: "text/plain", size: 10 }).valid).toBe(false);

    const empty = validateImageFile({ type: "image/png", size: 0 });
    expect(empty).toMatchObject({ valid: false, code: "empty_file" });

    const big = validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES + 1 });
    expect(big).toMatchObject({ valid: false, code: "file_too_large" });

    const atLimit = validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES });
    expect(atLimit).toEqual({ valid: true });
  });
});

describe("validateImageBatch", () => {
  const jpeg = (size: number) => ({ type: "image/jpeg", size });

  it("accepts one page up to the page limit within the total budget", () => {
    expect(validateImageBatch([jpeg(1024)])).toEqual({ valid: true });
    const pages = Array.from({ length: MAX_MENU_PAGES }, () => jpeg(1024));
    expect(validateImageBatch(pages)).toEqual({ valid: true });
  });

  it("rejects an empty selection and too many pages", () => {
    expect(validateImageBatch([])).toMatchObject({ valid: false, code: "empty_file" });
    const tooMany = Array.from({ length: MAX_MENU_PAGES + 1 }, () => jpeg(1024));
    expect(validateImageBatch(tooMany)).toMatchObject({ valid: false, code: "too_many_pages" });
  });

  it("reports the first invalid file in the batch", () => {
    expect(validateImageBatch([jpeg(1024), { type: "image/gif", size: 1024 }])).toMatchObject({
      valid: false,
      code: "invalid_file_type",
    });
    expect(validateImageBatch([jpeg(MAX_IMAGE_BYTES + 1)])).toMatchObject({
      valid: false,
      code: "file_too_large",
    });
  });

  it("bounds the combined size of all pages, not just each file", () => {
    // Each file alone is legal; together they exceed the request budget.
    const half = Math.floor(MAX_TOTAL_IMAGE_BYTES / 2) + 1;
    expect(validateImageFile({ type: "image/jpeg", size: half })).toEqual({ valid: true });
    const result = validateImageBatch([jpeg(half), jpeg(half)]);
    expect(result).toMatchObject({ valid: false, code: "file_too_large" });
    expect(result.valid === false && result.message).toContain("too large together");
  });
});

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const isoBmff = (brand: string) =>
  new Uint8Array([0, 0, 0, 0x1c, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0]);

const jpegHeader = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const pngHeader = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const webpHeader = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]);

 describe("detectImageMimeType", () => {
  it("identifies each supported header", () => {
    expect(detectImageMimeType(jpegHeader)).toBe("image/jpeg");
    expect(detectImageMimeType(pngHeader)).toBe("image/png");
    expect(detectImageMimeType(webpHeader)).toBe("image/webp");
    expect(detectImageMimeType(isoBmff("avif"))).toBe("image/avif");
    expect(detectImageMimeType(isoBmff("avis"))).toBe("image/avif");
    expect(detectImageMimeType(isoBmff("heic"))).toBe("image/heic");
    expect(detectImageMimeType(isoBmff("mif1"))).toBe("image/heif");
  });

  it("returns null for unknown, truncated, or empty data", () => {
    expect(detectImageMimeType(ascii("GIF89a"))).toBeNull();
    expect(detectImageMimeType(new Uint8Array(0))).toBeNull();
    expect(detectImageMimeType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageMimeType(ascii("ftypavif"))).toBeNull();
  });
});

describe("classifyImageBytes", () => {
  it("trusts the real header over a mislabeled declared type", () => {
    // The sample that motivated this: AVIF bytes behind a .jpg name.
    expect(classifyImageBytes(isoBmff("avif"), "image/jpeg", "board.jpg")).toEqual({
      action: "transcode",
      mimeType: "image/avif",
    });
    expect(classifyImageBytes(pngHeader, "image/jpeg", "page.jpg")).toEqual({
      action: "pass",
      mimeType: "image/png",
    });
  });

  it("passes HEIC and HEIF through to the provider", () => {
    expect(classifyImageBytes(isoBmff("heic"), "", "photo.HEIC")).toEqual({
      action: "pass",
      mimeType: "image/heic",
    });
    expect(classifyImageBytes(isoBmff("mif1"), "image/heif")).toEqual({
      action: "pass",
      mimeType: "image/heif",
    });
  });

  it("falls back to the declared type and extension when bytes are unknown", () => {
    expect(classifyImageBytes(bytes(0, 0, 0), "image/webp")).toEqual({
      action: "pass",
      mimeType: "image/webp",
    });
    expect(classifyImageBytes(bytes(0, 0, 0), "", "menu.avif")).toEqual({
      action: "transcode",
      mimeType: "image/avif",
    });
    expect(classifyImageBytes(bytes(0, 0, 0), "text/plain", "menu.txt")).toEqual({
      action: "unsupported",
      mimeType: null,
    });
  });
});

describe("mimeTypeFromFileName", () => {
  it("maps known extensions case-insensitively", () => {
    expect(mimeTypeFromFileName("A.JPG")).toBe("image/jpeg");
    expect(mimeTypeFromFileName("menu.avif")).toBe("image/avif");
    expect(mimeTypeFromFileName("photo.heic")).toBe("image/heic");
    expect(mimeTypeFromFileName("archive.zip")).toBeNull();
    expect(mimeTypeFromFileName(undefined)).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
