/**
 * Operator alerts (Step 11): a production failure must reach us without a
 * user report.
 *
 * Every alert is also a structured log line, so nothing is invisible when
 * email is not configured. Email reuses the Resend account that already sends
 * magic links — no new service, no new dependency. Set:
 *
 *   OPS_ALERT_EMAIL  where alerts go (our inbox)
 *   EMAIL_FROM       the verified sender already used for sign-in mail
 *   RESEND_API_KEY   existing key
 *
 * Deduplication is best-effort and per process: one alert per key per hour.
 * A cold serverless instance can repeat an alert, which is the right failure
 * mode — a duplicate email beats a silent outage.
 */

import {
  errorFields,
  logEvent,
  redactValue,
  scrubText,
  type LogFields,
} from "./log";

export interface OpsAlert {
  /** Human summary, used as the email subject. */
  subject: string;
  /** Plain-text detail. Scrub before it is rendered or sent. */
  details: string;
  /** Alerts sharing a key are throttled together (e.g. one per error event). */
  dedupeKey: string;
}

/** At most one email per dedupe key per hour, per process. */
export const ALERT_WINDOW_MS = 60 * 60 * 1000;

const recentAlerts = new Map<string, number>();

/** Test hook: forget which alerts were already sent. */
export function resetAlertDedupe(): void {
  recentAlerts.clear();
}

export function shouldSendAlert(
  dedupeKey: string,
  now: number = Date.now(),
  windowMs: number = ALERT_WINDOW_MS
): boolean {
  const last = recentAlerts.get(dedupeKey);
  if (last !== undefined && now - last < windowMs) return false;
  if (recentAlerts.size > 500) {
    for (const [key, sentAt] of recentAlerts) {
      if (now - sentAt >= windowMs) recentAlerts.delete(key);
    }
  }
  recentAlerts.set(dedupeKey, now);
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The email body for an alert. Kept pure so it can be asserted in tests. */
export function buildAlertEmail(
  alert: OpsAlert,
  now: Date = new Date()
): { subject: string; text: string; html: string } {
  const subject = `[Tablepass] ${scrubText(alert.subject)}`;
  const detail = scrubText(alert.details);
  const text = [
    subject,
    "",
    detail,
    "",
    `When: ${now.toISOString()}`,
    `Alert key: ${alert.dedupeKey}`,
    "",
    "This message is also in the server logs under event=ops_alert.",
  ].join("\n");
  return {
    subject,
    text,
    html: [
      `<p><strong>${escapeHtml(scrubText(alert.subject))}</strong></p>`,
      `<pre style="white-space:pre-wrap">${escapeHtml(detail)}</pre>`,
      `<p>When: ${escapeHtml(now.toISOString())}<br />Alert key: ${escapeHtml(alert.dedupeKey)}</p>`,
    ].join(""),
  };
}

export interface AlertDeps {
  fetchImpl?: typeof fetch;
  /** Overrides for tests; production reads the environment. */
  apiKey?: string;
  from?: string;
  to?: string;
}

/**
 * Send an alert if it is not throttled. Returns what happened so callers can
 * log it; never throws, because alerting must not break the request.
 */
export async function alertOps(
  alert: OpsAlert,
  deps: AlertDeps = {}
): Promise<"sent" | "suppressed" | "not_configured" | "failed"> {
  logEvent("error", "ops_alert", {
    alert: alert.subject,
    alertKey: alert.dedupeKey,
    details: alert.details,
  });

  if (!shouldSendAlert(alert.dedupeKey)) return "suppressed";

  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY;
  const from = deps.from ?? process.env.EMAIL_FROM;
  const to = deps.to ?? process.env.OPS_ALERT_EMAIL;
  if (!apiKey || !from || !to) {
    logEvent("warn", "ops_alert.not_configured", {
      alertKey: alert.dedupeKey,
      hint: "Set OPS_ALERT_EMAIL (and RESEND_API_KEY / EMAIL_FROM) to receive failure emails.",
    });
    return "not_configured";
  }

  const email = buildAlertEmail(alert);
  try {
    const response = await (deps.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logEvent("error", "ops_alert.delivery_failed", {
        alertKey: alert.dedupeKey,
        status: response.status,
      });
      return "failed";
    }
    return "sent";
  } catch (error) {
    logEvent("error", "ops_alert.delivery_failed", {
      alertKey: alert.dedupeKey,
      error: errorFields(error),
    });
    return "failed";
  }
}

/**
 * Log an unexpected server error and alert us about it. Await it in a catch
 * block: a floating promise can be dropped when the response is returned.
 *
 * The log line and the email carry the same redacted fields — never the
 * request body, never a stack, never a credential.
 */
export async function reportError(
  event: string,
  error: unknown,
  fields: LogFields = {}
): Promise<void> {
  logEvent("error", event, { ...fields, error });
  const safeFields = redactValue(fields);
  await alertOps({
    subject: `Server error: ${event}`,
    details: [
      `Event: ${event}`,
      `Error: ${JSON.stringify(errorFields(error))}`,
      `Context: ${JSON.stringify(safeFields ?? {})}`,
      "Look the event up in the server logs for the matching request id.",
    ].join("\n"),
    dedupeKey: `error:${event}:${errorFields(error).name}`,
  });
}
