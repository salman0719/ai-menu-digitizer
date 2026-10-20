import { describe, expect, it } from "vitest";

import { describeExtractionSource, providerLabel } from "../src/features/menu/source-label";

describe("providerLabel", () => {
  it("uses product names for known vendors", () => {
    expect(providerLabel("gemini")).toBe("Gemini");
    expect(providerLabel("groq")).toBe("Groq");
    // Stored values are lower-case, but a hand-edited document may not be.
    expect(providerLabel("Groq")).toBe("Groq");
  });

  it("shows an unknown vendor as stored rather than inventing a name", () => {
    expect(providerLabel("acme-vision")).toBe("acme-vision");
  });
});

describe("describeExtractionSource", () => {
  it("names the vendor and model that read the menu", () => {
    expect(
      describeExtractionSource({ provider: "groq", model: "qwen/qwen3.8-27b" })
    ).toBe("Read by Groq · qwen/qwen3.8-27b");
  });

  it("omits the model when none was recorded", () => {
    expect(describeExtractionSource({ provider: "gemini" })).toBe("Read by Gemini");
  });

  it("keeps demo data clearly labelled as demo", () => {
    expect(describeExtractionSource({ provider: "demo" })).toBe("Demo data");
  });

  it("says nothing when no source was recorded (imports, older documents)", () => {
    expect(describeExtractionSource(undefined)).toBeNull();
    expect(describeExtractionSource({})).toBeNull();
    expect(describeExtractionSource({ originalFileName: "menu.jpg" })).toBeNull();
  });
});
