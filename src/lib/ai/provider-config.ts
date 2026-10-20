/**
 * Provider selection (server-only). Today two vendors can read menu images:
 * Gemini (the launch default) and Groq. Both are configured purely through
 * environment variables so a deployment needs no code change:
 *
 *   AI_PROVIDER=gemini            # primary: "gemini" | "groq"
 *   AI_FALLBACK_PROVIDER=groq     # optional; defaults to the other vendor,
 *                                 # "none" disables the fallback
 *   GEMINI_API_KEY / GEMINI_MODEL
 *   GROQ_API_KEY / GROQ_MODEL
 *
 * Only vendors with a key are placed in the chain. When no key exists the
 * chain is empty and extraction reports `missing_api_key` (503), exactly as
 * before Groq existed.
 */

import { MAX_MENU_PAGES, type ProviderImageMimeType } from "../image-constraints";
import { logEvent } from "../observability/log";
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from "./gemini-provider";
import { createGroqProvider, DEFAULT_GROQ_MODEL, GROQ_MAX_IMAGES } from "./groq-provider";
import type { ExtractionProvider, ProviderName } from "./provider";

export const PROVIDER_ENV = "AI_PROVIDER";
export const FALLBACK_PROVIDER_ENV = "AI_FALLBACK_PROVIDER";
export const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
export const GROQ_API_KEY_ENV = "GROQ_API_KEY";
export const GEMINI_MODEL_ENV = "GEMINI_MODEL";
export const GROQ_MODEL_ENV = "GROQ_MODEL";

export const DEFAULT_PROVIDER: ProviderName = "gemini";

/**
 * Image types each vendor reads natively. Gemini documents JPEG/PNG/WebP/
 * HEIC/HEIF; Groq's vision guide only guarantees JPEG and PNG (WebP rides on
 * its OpenAI-compatible image input). Anything else is routed to a vendor
 * that can read it instead of being sent to one that cannot.
 */
export const PROVIDER_IMAGE_TYPES: Record<ProviderName, readonly ProviderImageMimeType[]> = {
  gemini: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  groq: ["image/jpeg", "image/png", "image/webp"],
};

/** Most page images one request may carry, per vendor. */
export const PROVIDER_MAX_IMAGES: Record<ProviderName, number> = {
  gemini: MAX_MENU_PAGES,
  groq: GROQ_MAX_IMAGES,
};

/** One configured vendor, ready to be tried in order. */
export interface ProviderSlot {
  name: ProviderName;
  model: string;
  provider: ExtractionProvider;
  supportedMimeTypes: readonly ProviderImageMimeType[];
  maxImages: number;
}

export interface ChainEnv {
  [key: string]: string | undefined;
}

export interface ProviderChainOptions {
  env?: ChainEnv;
  /** Correlates provider failures with the request log line. */
  requestId?: string;
  fetchImpl?: typeof fetch;
}

function isProviderName(value: string): value is ProviderName {
  return value === "gemini" || value === "groq";
}

/**
 * Read `AI_PROVIDER`, falling back to Gemini when unset or unrecognised. An
 * unknown value is a configuration mistake worth a log line, not a 500.
 */
export function primaryProviderName(env: ChainEnv = process.env): ProviderName {
  const raw = (env[PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER;
  if (isProviderName(raw)) return raw;
  logEvent("warn", "ai.unknown_provider", { configured: raw, using: DEFAULT_PROVIDER });
  return DEFAULT_PROVIDER;
}

/**
 * The configured fallback. Unset means "the other vendor" (so adding a Groq
 * key is enough to get failover); `none`/`off` disables it explicitly.
 */
export function fallbackProviderName(
  primary: ProviderName,
  env: ChainEnv = process.env
): ProviderName | null {
  const raw = (env[FALLBACK_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (raw === "none" || raw === "off") return null;
  if (raw && isProviderName(raw)) return raw === primary ? null : raw;
  if (raw) {
    logEvent("warn", "ai.unknown_fallback_provider", { configured: raw });
    return null;
  }
  return primary === "gemini" ? "groq" : "gemini";
}

function apiKeyFor(name: ProviderName, env: ChainEnv): string | undefined {
  const value = env[name === "gemini" ? GEMINI_API_KEY_ENV : GROQ_API_KEY_ENV];
  return value?.trim() ? value : undefined;
}

function modelFor(name: ProviderName, env: ChainEnv): string {
  if (name === "gemini") {
    return env[GEMINI_MODEL_ENV]?.trim() || DEFAULT_GEMINI_MODEL;
  }
  return env[GROQ_MODEL_ENV]?.trim() || DEFAULT_GROQ_MODEL;
}

function createSlot(
  name: ProviderName,
  env: ChainEnv,
  options: ProviderChainOptions
): ProviderSlot | null {
  const apiKey = apiKeyFor(name, env);
  if (!apiKey) return null;
  const model = modelFor(name, env);
  const provider =
    name === "gemini"
      ? createGeminiProvider({
          apiKey,
          model,
          fetchImpl: options.fetchImpl,
          requestId: options.requestId,
        })
      : createGroqProvider({
          apiKey,
          model,
          fetchImpl: options.fetchImpl,
          requestId: options.requestId,
        });
  return {
    name,
    model,
    provider,
    supportedMimeTypes: PROVIDER_IMAGE_TYPES[name],
    maxImages: PROVIDER_MAX_IMAGES[name],
  };
}

/**
 * Build the ordered list of vendors to try. Primary first, then the
 * fallback; vendors without a key are skipped silently (they are simply not
 * configured). An empty result means extraction is unavailable.
 */
export function buildProviderChain(options: ProviderChainOptions = {}): ProviderSlot[] {
  const env = options.env ?? process.env;
  const primary = primaryProviderName(env);
  const fallback = fallbackProviderName(primary, env);

  const chain: ProviderSlot[] = [];
  for (const name of [primary, fallback]) {
    if (!name) continue;
    if (chain.some((slot) => slot.name === name)) continue;
    const slot = createSlot(name, env, options);
    if (slot) chain.push(slot);
  }
  return chain;
}
