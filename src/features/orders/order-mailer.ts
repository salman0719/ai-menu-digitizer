import {
  EMAIL_COLORS,
  emailCtaButton,
  emailFallbackLink,
  emailLogoMark,
  emailPage,
  escapeEmailHtml,
} from "@/lib/email-layout";
import { formatPreviewPrice } from "@/features/menu/preview-utils";
import { publicBaseUrl } from "@/features/tenancy/invite-mailer";
import { eq } from "drizzle-orm";

import { restaurant as restaurantTable } from "@/lib/db/schema";
import { logEvent } from "@/lib/observability/log";
import type { TenancyDb } from "@/features/tenancy/repo";

import { listOwnerEmails, recordOrderEmailAttempt, wasOrderEmailed } from "./alerts";
import { orderCode, orderTotal, type Order } from "./schema";
import { formatTableLabel } from "./table-links";

/**
 * New-order email (R0.4, report 5 tier 3): one email per order to the
 * restaurant, best-effort — a failed or skipped send never fails the
 * diner's POST, and the in-app monitor still catches the order.
 *
 * Server-only: Resend REST with the same contract as the auth mail
 * (no key → dev console + return, prod → honest throw). Nothing secret,
 * personal, or stack-shaped ever reaches the diner or the logs.
 */

export interface NewOrderEmail {
  email: string;
  restaurantName: string;
  order: Order;
  boardUrl: string;
}

/** Pure branded new-order body, asserted in tests and reused by the sender. */
export function buildNewOrderEmail({
  email,
  restaurantName,
  order,
  boardUrl,
}: NewOrderEmail): { subject: string; text: string; html: string } {
  const table = formatTableLabel(order.tableLabel);
  const code = orderCode(order.id);
  const subject = `New order · ${table} — ${restaurantName}`;
  const total = orderTotal(order.lines);
  const totalLine =
    total === null
      ? "Total to confirm at the counter (a line had no price)."
      : `Total: ${formatPreviewPrice(total, null, order.currency)}`;
  const lineTexts = order.lines.map(
    (line) =>
      `${line.quantity}× ${line.name}${line.variantName ? ` (${line.variantName})` : ""} — ` +
      (line.unitPrice === null
        ? "no price"
        : formatPreviewPrice(line.unitPrice * line.quantity, null, order.currency))
  );
  const text =
    `New order #${code} for ${table} at ${restaurantName}.\n` +
    lineTexts.map((line) => `  ${line}`).join("\n") +
    `\n${totalLine}\n` +
    (order.note ? `Note: ${order.note}\n` : "") +
    `Open the board: ${boardUrl}\n`;

  const lineRows = order.lines
    .map(
      (line) =>
        `<tr><td style=\"padding:7px 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:${EMAIL_COLORS.BODY_TEXT}\">` +
        `<strong>${line.quantity}×</strong> ${escapeEmailHtml(line.name)}` +
        (line.variantName ? ` <span style=\"color:${EMAIL_COLORS.MUTED}\">${escapeEmailHtml(line.variantName)}</span>` : "") +
        `</td><td align=\"right\" style=\"padding:7px 0;font-family:Arial,sans-serif;font-size:13px;color:${EMAIL_COLORS.BODY_TEXT}\">` +
        (line.unitPrice === null
          ? "no price"
          : escapeEmailHtml(
              formatPreviewPrice(line.unitPrice * line.quantity, null, order.currency)
            )) +
        `</td></tr>`
    )
    .join("");
  const cardInner =
    `<tr><td align=\"center\" style=\"padding:28px 28px 8px\">` +
    emailLogoMark() +
    `<p style=\"margin:12px 0 0;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:${EMAIL_COLORS.INK}\">Eateryo</p>` +
    `</td></tr>` +
    `<tr><td style=\"padding:12px 32px 0;font-family:Arial,sans-serif\">` +
    `<h1 style=\"margin:0 0 4px;font-size:22px;line-height:1.25;color:${EMAIL_COLORS.INK}\">New order · ${escapeEmailHtml(table)}</h1>` +
    `<p style=\"margin:0;font-size:13px;line-height:1.6;color:${EMAIL_COLORS.MUTED}\">${escapeEmailHtml(restaurantName)} &middot; order <strong>#${escapeEmailHtml(code)}</strong> &middot; ${escapeEmailHtml(order.menuTitle)}</p>` +
    `</td></tr>` +
    `<tr><td style=\"padding:14px 32px 0;font-family:Arial,sans-serif\">` +
    `<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#fafaf9;border:1px solid ${EMAIL_COLORS.CARD_BORDER};border-radius:12px\">` +
    `<tr><td style=\"padding:14px 16px\">` +
    `<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">${lineRows}</table>` +
    `<p style=\"margin:10px 0 0;font-size:13px;font-weight:bold;color:${EMAIL_COLORS.INK}\">${escapeEmailHtml(totalLine)}</p>` +
    (order.note
      ? `<p style=\"margin:8px 0 0;font-size:13px;line-height:1.6;color:${EMAIL_COLORS.BODY_TEXT}\">Note: ${escapeEmailHtml(order.note)}</p>`
      : "") +
    `</td></tr></table>` +
    `</td></tr>` +
    `<tr><td align=\"center\" style=\"padding:22px 32px 4px\">` +
    emailCtaButton("Open the Orders board", boardUrl) +
    emailFallbackLink(boardUrl) +
    `</td></tr>` +
    `<tr><td style=\"padding:20px 32px 0\"><hr style=\"border:0;border-top:1px solid ${EMAIL_COLORS.CARD_BORDER};margin:0\" /></td></tr>` +
    `<tr><td style=\"padding:14px 32px 26px;font-family:Arial,sans-serif\">` +
    `<p style=\"margin:0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.FAINT}\">One email per order — a rush of orders only alerts the board.<br />This message was sent to <span style=\"color:${EMAIL_COLORS.MUTED}\">${escapeEmailHtml(email)}</span> because new-order alerts are on for ${escapeEmailHtml(restaurantName)}.</p>` +
    `</td></tr>`;
  const html = emailPage({
    preheader: `New order ${table} — ${restaurantName}`,
    cardInner,
  });
  return { subject, text, html };
}

export async function sendNewOrderEmail(input: NewOrderEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      console.error("[orders] new-order email is not configured (RESEND_API_KEY / EMAIL_FROM)");
      throw new Error("New-order email delivery is not configured");
    }
    console.warn(
      `[orders] RESEND_API_KEY not set — new-order email was NOT delivered to ${input.email}.\n` +
        `[orders] Dev order email subject: ${buildNewOrderEmail(input).subject}`
    );
    return;
  }

  const content = buildNewOrderEmail(input);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });

  if (!response.ok) {
    // Provider status only — no credentials, no response body, no stack.
    console.error(`[orders] Resend new-order send failed with status ${response.status}`);
    throw new Error("Failed to send new-order email");
  }
}

export type OrderEmailSkip =
  | "disabled"
  | "no_recipient"
  | "duplicate"
  | "digest"
  | "failed";

export type OrderEmailOutcome = { mailed: true } | { mailed: false; skipped: OrderEmailSkip };

/**
 * Best-effort post-placement hook for `POST /api/orders`. Resolves the
 * restaurant's preference (override address, else the owners' account
 * emails), applies the idempotency + digest gate, sends, and records the
 * send. Never throws: every skip and every failure is logged with the
 * order id and the route still answers 201.
 */
export async function maybeEmailNewOrder(
  db: TenancyDb,
  order: Order,
  restaurantId: string,
  restaurantName: string,
  request: Request,
  deps: { sendEmail?: (input: NewOrderEmail) => Promise<void> } = {}
): Promise<OrderEmailOutcome> {
  const sendEmail = deps.sendEmail ?? sendNewOrderEmail;
  const fail = (skipped: OrderEmailSkip, details: string): OrderEmailOutcome => {
    logEvent("warn", "orders.email_skipped", {
      orderId: order.id,
      restaurantId,
      reason: skipped,
      details,
    });
    return { mailed: false, skipped };
  };
  try {
    const prefs = await getOrderAlertPrefsForRestaurant(db, restaurantId);
    if (!prefs || !prefs.enabled) return fail("disabled", "alerts off or restaurant unknown");
    const recipients = prefs.email ? [prefs.email] : await listOwnerEmails(db, restaurantId);
    if (recipients.length === 0) return fail("no_recipient", "no owner email on file");
    if (await wasOrderEmailed(db, order.id)) return fail("duplicate", "already mailed");
    const email = recipients[0]!;
    const boardUrl = `${publicBaseUrl(request)}/orders`;
    await sendEmail({ email, restaurantName, order, boardUrl });
    const attempt = await recordOrderEmailAttempt(db, restaurantId, order.id, email);
    if (!attempt.mailed) return fail(attempt.reason, "lost the log race after sending");
    logEvent("info", "orders.email_sent", { orderId: order.id, restaurantId });
    return { mailed: true };
  } catch (error) {
    return fail(
      "failed",
      error instanceof Error ? error.message : "unknown send failure"
    );
  }
}

/**
 * System-context preference read for the post-placement hook (no session on
 * the anonymous ordering path — the order itself proves the restaurant, and
 * the read stays inside that tenant).
 */
async function getOrderAlertPrefsForRestaurant(
  db: TenancyDb,
  restaurantId: string
): Promise<{ enabled: boolean; email: string | null } | null> {
  const rows = await db
    .select({
      enabled: restaurantTable.orderAlertsEnabled,
      email: restaurantTable.orderAlertEmail,
    })
    .from(restaurantTable)
    .where(eq(restaurantTable.id, restaurantId))
    .limit(1);
  const row = rows[0];
  return row ? { enabled: row.enabled, email: row.email } : null;
}
