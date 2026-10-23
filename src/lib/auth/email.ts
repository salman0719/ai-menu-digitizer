/**
 * Magic-link email delivery via Resend's REST API (no extra dependency —
 * the endpoint is a single authenticated POST).
 *
 * Sign-in volume for this product is tiny (café owners/staff), well within
 * the Resend free tier. The sending domain must be verified (SPF + DKIM)
 * before production use, and link tracking must be off for auth mail.
 */
import {
  EMAIL_COLORS,
  emailCtaButton,
  emailFallbackLink,
  emailLogoMark,
  emailPage,
  escapeEmailHtml,
} from "@/lib/email-layout";

export interface MagicLinkEmail {
  email: string;
  url: string;
}

/** Pure branded magic-link body, asserted in tests and reused by the sender. */
export function buildMagicLinkEmail({ email, url }: MagicLinkEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "Your Eateryo sign-in link";
  const text =
    `Sign in to Eateryo: ${url}\n\n` +
    `This link can be used once and expires in 5 minutes.\n` +
    `If you didn't request this, you can ignore this email.\n`;
  const cardInner =
    `<tr><td align="center" style="padding:28px 28px 8px">` +
    emailLogoMark() +
    `<p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:${EMAIL_COLORS.INK};letter-spacing:-.01em">Eateryo</p>` +
    `<p style="margin:2px 0 0;font-family:Arial,sans-serif;font-size:12px;color:${EMAIL_COLORS.MUTED}">Menus, tables, and orders in one place</p>` +
    `</td></tr>` +
    `<tr><td style="padding:12px 32px 0;font-family:Arial,sans-serif">` +
    `<h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:${EMAIL_COLORS.INK}">Sign in to Eateryo</h1>` +
    `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:${EMAIL_COLORS.BODY_TEXT}">Hi there \u2014 tap the button below to sign in. No password needed.</p>` +
    `<p style="margin:0;font-size:13px;line-height:1.6;color:${EMAIL_COLORS.MUTED}">This link can be used <strong>once</strong> and expires in <strong>5&nbsp;minutes</strong>.</p>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:22px 32px 8px">` +
    emailCtaButton("Sign in \u2192", url) +
    `</td></tr>` +
    `<tr><td style="padding:8px 32px 0;font-family:Arial,sans-serif">` +
    `<p style="margin:0 0 4px;font-size:12px;color:${EMAIL_COLORS.MUTED}">Button not working? Paste this link into your browser:</p>` +
    emailFallbackLink(url) +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px 0"><hr style="border:0;border-top:1px solid ${EMAIL_COLORS.CARD_BORDER};margin:0" /></td></tr>` +
    `<tr><td style="padding:14px 32px 26px;font-family:Arial,sans-serif">` +
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.FAINT}">If you didn\u2019t request this, you can safely ignore this email.<br />This message was sent to <span style="color:${EMAIL_COLORS.MUTED}">${escapeEmailHtml(email)}</span>.</p>` +
    `</td></tr>`;
  const html = emailPage({
    preheader: "One tap to sign in \u2014 expires in 5 minutes.",
    cardInner,
  });
  return { subject, text, html };
}

export interface InvitationEmail {
  email: string;
  restaurantName: string;
  inviterName: string;
  role: "owner" | "staff";
  url: string;
}

export async function sendMagicLinkEmail({ email, url }: MagicLinkEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      // Never fall back to logging links in production — logs are readable
      // by others and a magic link is a credential. Fail honestly instead.
      console.error("[auth] sign-in email is not configured (RESEND_API_KEY / EMAIL_FROM)");
      throw new Error("Sign-in email delivery is not configured");
    }
    console.warn(
      `[auth] RESEND_API_KEY not set — magic link was NOT delivered to ${email}.\n` +
        `[auth] Dev sign-in link: ${url}`
    );
    return;
  }

  const content = buildMagicLinkEmail({ email, url });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });

  if (!response.ok) {
    // Provider status only — no credentials, no response body, no stack.
    console.error(`[auth] Resend send failed with status ${response.status}`);
    throw new Error("Failed to send sign-in email");
  }
}

/**
 * Team invitation delivery, same contract as the magic link: Resend REST,
 * no link logging in production, honest failure when unconfigured.
 */
export async function sendInvitationEmail({
  email,
  restaurantName,
  inviterName,
  role,
  url,
}: InvitationEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      console.error("[auth] invitation email is not configured (RESEND_API_KEY / EMAIL_FROM)");
      throw new Error("Invitation email delivery is not configured");
    }
    console.warn(
      `[auth] RESEND_API_KEY not set — invitation was NOT delivered to ${email}.\n` +
        `[auth] Dev invitation link: ${url}`
    );
    return;
  }

  const roleLabel = role === "owner" ? "an owner" : "staff";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${inviterName} invited you to ${restaurantName} on Eateryo`,
      html: [
        `<p>${inviterName} invited you to join <strong>${restaurantName}</strong> on Eateryo as ${roleLabel}.</p>`,
        `<p><a href="${url}">Accept the invitation</a></p>`,
        "<p>Signing in with this email address accepts the invitation. The link expires in 7 days.</p>",
        "<p>If you weren't expecting this, you can ignore this email.</p>",
      ].join(""),
      text: `${inviterName} invited you to join ${restaurantName} on Eateryo as ${roleLabel}.\n\nAccept: ${url}\n\nSigning in with this email address accepts the invitation. The link expires in 7 days.\n`,
    }),
  });

  if (!response.ok) {
    // Provider status only — no credentials, no response body, no stack.
    console.error(`[auth] Resend invitation send failed with status ${response.status}`);
    throw new Error("Failed to send invitation email");
  }
}
