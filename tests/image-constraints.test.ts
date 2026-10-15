import { describe, expect, it } from "vitest";

import { formatFileSize, MAX_IMAGE_BYTES, validateImageFile } from "../src/lib/image-constraints";

describe("validateImageFile", () => {
  it("accepts supported types within the size limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateImageFile({ type, size: 1024 })).toEqual({ valid: true });
    }
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

describe("formatFileSize", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
