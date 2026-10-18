/**
 * Provider cost, computed only from what we actually know.
 *
 * Token prices are configuration, not code: the launch has to survive a
 * vendor price change without a deploy, and inventing a price in a constant
 * would make the spend panel lie. Set both rates (USD per million tokens):
 *
 *   GEMINI_INPUT_USD_PER_MTOK=0.30
 *   GEMINI_OUTPUT_USD_PER_MTOK=2.50
 *
 * Until both are set, `costMicros` is null and the UI says the cost is not
 * configured — it never guesses.
 */

import type { ProviderUsage } from "@/lib/ai/provider";

export const GEMINI_INPUT_RATE_ENV = "GEMINI_INPUT_USD_PER_MTOK";
export const GEMINI_OUTPUT_RATE_ENV = "GEMINI_OUTPUT_USD_PER_MTOK";

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

/** Both rates, or null when either is missing. */
export function tokenRatesFromEnv(
  env: Record<string, string | undefined> = process.env
): TokenRates | null {
  const input = readRate(env[GEMINI_INPUT_RATE_ENV]);
  const output = readRate(env[GEMINI_OUTPUT_RATE_ENV]);
  if (input === null || output === null) return null;
  return { inputUsdPerMillion: input, outputUsdPerMillion: output };
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
