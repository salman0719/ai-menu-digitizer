/**
 * Provider cost, computed only from what we actually know.
 *
 * Token prices are configuration, not code: the launch has to survive a
 * vendor price change without a deploy, and inventing a price in a constant
 * would make the spend panel lie. Each vendor has its own pair of rates
 * (USD per million tokens), because Gemini and Groq bill differently:
 *
 *   GEMINI_INPUT_USD_PER_MTOK=0.30
 *   GEMINI_OUTPUT_USD_PER_MTOK=2.50
 *   GROQ_INPUT_USD_PER_MTOK=0.80
 *   GROQ_OUTPUT_USD_PER_MTOK=4.00
 *
 * Until a vendor's pair is set, calls it served are unpriced: `costMicros`
 * is null and the UI says the cost is not configured — it never guesses.
 */

import type { ProviderName, ProviderUsage } from "@/lib/ai/provider";

export const PROVIDER_NAMES: readonly ProviderName[] = ["gemini", "groq"];

/** Env var names per vendor; names only, never values. */
export const PROVIDER_RATE_ENV: Record<
  ProviderName,
  { input: string; output: string }
> = {
  gemini: {
    input: "GEMINI_INPUT_USD_PER_MTOK",
    output: "GEMINI_OUTPUT_USD_PER_MTOK",
  },
  groq: {
    input: "GROQ_INPUT_USD_PER_MTOK",
    output: "GROQ_OUTPUT_USD_PER_MTOK",
  },
};

export interface TokenRates {
  /** USD per one million input tokens. */
  inputUsdPerMillion: number;
  /** USD per one million output tokens. */
  outputUsdPerMillion: number;
}

function readRate(value: string | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/** Both rates for one vendor, or null when either is missing. */
export function tokenRatesFor(
  provider: ProviderName,
  env: Record<string, string | undefined> = process.env
): TokenRates | null {
  const names = PROVIDER_RATE_ENV[provider];
  const input = readRate(env[names.input]);
  const output = readRate(env[names.output]);
  if (input === null || output === null) return null;
  return { inputUsdPerMillion: input, outputUsdPerMillion: output };
}

/** Vendors whose rates are fully configured. */
export function configuredProviders(
  env: Record<string, string | undefined> = process.env
): ProviderName[] {
  return PROVIDER_NAMES.filter((provider) => tokenRatesFor(provider, env) !== null);
}

/**
 * Cost in micro-USD (1e-6 dollars). Because a rate is "dollars per million
 * tokens", one token costs `rate` micro-dollars — the units cancel exactly.
 * Null unless both token counts and both rates are known.
 */
export function costMicros(usage: ProviderUsage, rates: TokenRates | null): number | null {
  if (!rates) return null;
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  return Math.round(
    usage.inputTokens * rates.inputUsdPerMillion +
      usage.outputTokens * rates.outputUsdPerMillion
  );
}

/** "$0.0123" — four decimals, the smallest amount worth showing. */
export function formatMicroUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}
