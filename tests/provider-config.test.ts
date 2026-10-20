import { describe, expect, it } from "vitest";

import {
  buildProviderChain,
  DEFAULT_PROVIDER,
  primaryProviderName,
  PROVIDER_MAX_IMAGES,
} from "../src/lib/ai/provider-config";
import { DEFAULT_GEMINI_MODEL } from "../src/lib/ai/gemini-provider";
import { DEFAULT_GROQ_MODEL } from "../src/lib/ai/groq-provider";

const BOTH_KEYS = { GEMINI_API_KEY: "gemini-key", GROQ_API_KEY: "groq-key" };

describe("provider selection", () => {
  it("defaults to Gemini when nothing is configured", () => {
    expect(primaryProviderName({})).toBe(DEFAULT_PROVIDER);
    expect(DEFAULT_PROVIDER).toBe("gemini");
  });

  it("honours AI_PROVIDER and ignores an unknown value", () => {
    expect(primaryProviderName({ AI_PROVIDER: "groq" })).toBe("groq");
    expect(primaryProviderName({ AI_PROVIDER: " GROQ " })).toBe("groq");
    expect(primaryProviderName({ AI_PROVIDER: "something-else" })).toBe("gemini");
  });

  it("keeps Gemini as the primary and Groq as the fallback by default", () => {
    const chain = buildProviderChain({ env: BOTH_KEYS });
    expect(chain.map((slot) => slot.name)).toEqual(["gemini", "groq"]);
    expect(chain[0].model).toBe(DEFAULT_GEMINI_MODEL);
    expect(chain[1].model).toBe(DEFAULT_GROQ_MODEL);
    expect(PROVIDER_MAX_IMAGES.groq).toBe(3);
  });

  it("puts Groq first when AI_PROVIDER=groq, with Gemini as the fallback", () => {
    const chain = buildProviderChain({ env: { ...BOTH_KEYS, AI_PROVIDER: "groq" } });
    expect(chain.map((slot) => slot.name)).toEqual(["groq", "gemini"]);
  });

  it("skips a vendor that has no key", () => {
    expect(
      buildProviderChain({ env: { GROQ_API_KEY: "groq-key" } }).map((slot) => slot.name)
    ).toEqual(["groq"]);
    expect(
      buildProviderChain({ env: { GEMINI_API_KEY: "gemini-key", AI_PROVIDER: "groq" } }).map(
        (slot) => slot.name
      )
    ).toEqual(["gemini"]);
    expect(buildProviderChain({ env: {} })).toEqual([]);
  });

  it("lets the fallback be disabled explicitly", () => {
    expect(
      buildProviderChain({ env: { ...BOTH_KEYS, AI_FALLBACK_PROVIDER: "none" } }).map(
        (slot) => slot.name
      )
    ).toEqual(["gemini"]);
  });

  it("does not list the same vendor twice", () => {
    expect(
      buildProviderChain({ env: { ...BOTH_KEYS, AI_FALLBACK_PROVIDER: "gemini" } }).map(
        (slot) => slot.name
      )
    ).toEqual(["gemini"]);
  });

  it("reads per-vendor model overrides", () => {
    const chain = buildProviderChain({
      env: { ...BOTH_KEYS, GEMINI_MODEL: "gemini-custom", GROQ_MODEL: "groq-custom" },
    });
    expect(chain.map((slot) => slot.model)).toEqual(["gemini-custom", "groq-custom"]);
  });

  it("knows which image types each vendor can read", () => {
    const [gemini, groq] = buildProviderChain({ env: BOTH_KEYS });
    expect(gemini.supportedMimeTypes).toContain("image/heic");
    expect(groq.supportedMimeTypes).not.toContain("image/heic");
    expect(groq.supportedMimeTypes).toContain("image/jpeg");
  });
});
