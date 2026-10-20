/**
 * Browser client for `POST /api/extract-menu`.
 *
 * The AI result is imported as a type only — erased at compile time, so no
 * server code enters the client bundle. The server validates with Zod; here
 * we map the `{ error }` contract and network failures to typed errors.
 */

import type { ExtractedMenu } from "./ai/extraction-schema";

export type ExtractClientErrorCode =
  | "missing_image"
  | "invalid_file_type"
  | "file_too_large"
  | "empty_file"
  | "too_many_pages"
  | "missing_api_key"
  | "provider_auth_failed"
  | "quota_exhausted"
  | "content_blocked"
  | "provider_unavailable"
  | "invalid_ai_response"
  | "internal_error"
  | "unexpected_response"
  | "network_error";

export class ExtractClientError extends Error {
  readonly code: ExtractClientErrorCode;

  constructor(code: ExtractClientErrorCode, message: string) {
    super(message);
    this.name = "ExtractClientError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const KNOWN_CODES: readonly string[] = [
  "missing_image",
  "invalid_file_type",
  "file_too_large",
  "empty_file",
  "too_many_pages",
  "missing_api_key",
  "provider_auth_failed",
  "quota_exhausted",
  "content_blocked",
  "provider_unavailable",
  "invalid_ai_response",
  "internal_error",
];

/**
 * One extraction result: the menu plus which vendor/model served it, so the
 * saved menu documents where its data actually came from (including when the
 * request failed over to a second provider).
 */
export interface MenuExtractionResult {
  menu: ExtractedMenu;
  /** Reported by the server; absent only on an older/mismatched server. */
  provider?: string;
  model?: string;
}

/**
 * Post one or more page images of the same menu (in reading order). The
 * server extracts them in a single call and returns one merged menu.
 */
export async function extractMenuFromFiles(
  input: File | File[],
  fetchImpl: typeof fetch = fetch
): Promise<MenuExtractionResult> {
  const files = Array.isArray(input) ? input : [input];
  const form = new FormData();
  for (const file of files) form.append("image", file);

  let response: Response;
  try {
    response = await fetchImpl("/api/extract-menu", { method: "POST", body: form });
  } catch {
    throw new ExtractClientError(
      "network_error",
      "Could not reach the server. Check your connection and try again."
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const err = isRecord(body) ? body.error : undefined;
    const rawCode = isRecord(err) && typeof err.code === "string" ? err.code : null;
    const code: ExtractClientErrorCode =
      rawCode && (KNOWN_CODES as readonly string[]).includes(rawCode)
        ? (rawCode as ExtractClientErrorCode)
        : "internal_error";
    const message =
      isRecord(err) && typeof err.message === "string" && err.message
        ? err.message
        : "Something went wrong. Try again.";
    throw new ExtractClientError(code, message);
  }

  const menu = isRecord(body) ? body.menu : undefined;
  if (!isRecord(menu) || !Array.isArray((menu as { categories?: unknown }).categories)) {
    throw new ExtractClientError(
      "unexpected_response",
      "The server returned an unexpected response. Try again."
    );
  }
  const provider =
    isRecord(body) && typeof body.provider === "string" && body.provider
      ? body.provider
      : undefined;
  const model =
    isRecord(body) && typeof body.model === "string" && body.model ? body.model : undefined;
  return {
    menu: menu as ExtractedMenu,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
}
