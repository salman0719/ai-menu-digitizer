/**
 * Structured server logs (Step 11).
 *
 * One JSON object per line, so a Vercel log drain can filter by `event`,
 * `level`, or `requestId` without guessing at prose. `requestId` is minted in
 * `src/proxy.ts` and echoed on the response, so a user can report the id from
 * the network tab and we can find the exact server line.
 *
 * What this module refuses to do:
 * - log a stack trace (the roadmap's hardening rule: no stack traces in log
 *   lines, since they can carry locals and paths),
 * - log a value under a key that looks like a credential,
 * - log anything that looks like a Google API key, a bearer token, or a
 *   database URL with a password in it, even when it is embedded in a message.
 *
 * Server-only by convention: nothing here is imported by a client component.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export const REDACTED = "[redacted]";
/** Longest string/number kept verbatim; the rest is truncated with an ellipsis. */
export const MAX_LOG_VALUE_LENGTH = 300;
const MAX_DEPTH = 3;

/**
 * Credential-shaped keys. Deliberately narrower than "contains token":
 * `inputTokens`/`outputTokens` are usage counts we want to keep, while
 * `sessionToken`/`accessToken` are credentials we must drop.
 */
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|secret|password|passwd|token|api[-_]?key|apikey|dsn|database[-_]?url|databaseurl|connection[-_]?string|connectionstring|verification[-_]?value)$/i;
const SENSITIVE_KEY_SUFFIX = /(Secret|Password|Token|ApiKey|ApiKEY|Cookie|Dsn)$/;

/** Shapes that must never survive into a log line, wherever they appear. */
const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  // Google API keys (the Gemini key), however they leak into a message.
  [/AIza[0-9A-Za-z_-]{30,}/g, `AIza${REDACTED}`],
  // Bearer credentials.
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, `Bearer ${REDACTED}`],
  // postgres://user:password@host/... — keep the host, drop the credentials.
  [/(postgres(?:ql)?:\/\/)[^\s@/]+(:[^\s@/]*)?@/gi, `$1${REDACTED}@`],
  // Resend-style keys and generic `secret=` query parameters.
  [/\bre_[A-Za-z0-9]{16,}/g, `re_${REDACTED}`],
  [/([?&](?:key|token|secret|password)=)[^\s&]+/gi, `$1${REDACTED}`],
];

/** Scrub credentials that may be embedded in arbitrary text. */
export function scrubText(value: string): string {
  let next = value;
  for (const [pattern, replacement] of SENSITIVE_TEXT_PATTERNS) {
    next = next.replace(pattern, replacement);
  }
  return next.length > MAX_LOG_VALUE_LENGTH ? `${next.slice(0, MAX_LOG_VALUE_LENGTH)}…` : next;
}

/**
 * Make any value safe to serialize: sensitive keys are replaced, strings are
 * scrubbed and truncated, Errors become `{ name, message }` (never a stack),
 * and cycles/very deep structures are cut off.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value === "function") return "[function]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return errorFields(value);
  if (depth >= MAX_DEPTH) return "[depth limit]";

  if (Array.isArray(value)) {
    // Bound the payload: a log line must stay one readable line.
    const capped = value.slice(0, 20).map((item) => redactValue(item, depth + 1));
    return value.length > capped.length ? [...capped, `…${value.length - capped.length} more`] : capped;
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] =
        SENSITIVE_KEY.test(key) || SENSITIVE_KEY_SUFFIX.test(key)
          ? REDACTED
          : redactValue(entry, depth + 1);
    }
    return output;
  }

  return String(value);
}

/** The one shape an error takes in a log line: no stack, no provider body. */
export function errorFields(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: scrubText(error.message),
      ...(typeof code === "string" ? { code } : {}),
    };
  }
  return { name: "UnknownError", message: scrubText(String(error)) };
}

/**
 * Accept an incoming request id only when it looks like one, so a hostile
 * header cannot inject newlines or arbitrary text into our log lines.
 */
export function sanitizeRequestId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{8,64}$/.test(trimmed) ? trimmed : null;
}

/** Read the id the proxy attached; `"unknown"` outside a request context. */
export function requestIdFrom(request: { headers: { get(name: string): string | null } }): string {
  return sanitizeRequestId(request.headers.get("x-request-id")) ?? "unknown";
}

/**
 * Build the record without writing it. Exposed for tests and for callers that
 * need to forward the same fields to an error tracker.
 */
export function buildLogRecord(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date()
): Record<string, unknown> {
  const redacted = redactValue(fields) as Record<string, unknown> | undefined;
  return {
    ts: now.toISOString(),
    level,
    event,
    ...(redacted ?? {}),
  };
}

/** Write one structured line. Never throws, whatever it is handed. */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date()
): Record<string, unknown> {
  let record: Record<string, unknown>;
  try {
    record = buildLogRecord(level, event, fields, now);
  } catch {
    record = { ts: now.toISOString(), level, event, message: "log serialization failed" };
  }
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return record;
}

/** Convenience for the common `info` case. */
export function logInfo(event: string, fields: LogFields = {}): void {
  logEvent("info", event, fields);
}
