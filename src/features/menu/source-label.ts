/**
 * Human-readable provenance for a menu ("Read by Groq · qwen/qwen3.8-27b").
 *
 * The vendor that answered an extraction is stored with the menu, not just
 * logged, so an owner looking at surprising data can see which model read
 * their photo. Pure and dependency-free: it runs in the editor, which must
 * never import provider modules.
 */

import type { MenuSource } from "./schema";

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  groq: "Groq",
  demo: "Demo data",
};

/** Known vendors get their product name; anything else is shown as stored. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
}

/**
 * One line describing who produced the menu, or null when the document has
 * no recorded source (an imported file, or a document saved before the
 * provider was recorded) — in which case the UI says nothing rather than
 * guessing "Gemini".
 */
export function describeExtractionSource(source: MenuSource | undefined): string | null {
  if (!source?.provider) return null;
  if (source.provider === "demo") return "Demo data";
  const label = providerLabel(source.provider);
  const model = source.model?.trim();
  return model ? `Read by ${label} · ${model}` : `Read by ${label}`;
}
