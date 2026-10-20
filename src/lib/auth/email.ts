/**
 * Magic-link email delivery via Resend's REST API (no extra dependency —
 * the endpoint is a single authenticated POST).
 *
 * Sign-in volume for this product is tiny (café owners/staff), well within
 * the Resend free tier. The sending domain must be verified (SPF + DKIM)
 * before production use, and link tracking must be off for auth mail.
 */
export interface MagicLinkEmail {
  email: string;
  url: string;
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

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your sign-in link",
      html: [
        "<p>Sign in to Tablepass:</p>",
        `<p><a href="${url}">Sign in</a></p>`,
        "<p>This link can be used once and expires in 5 minutes.</p>",
        "<p>If you didn't request this, you can ignore this email.</p>",
      ].join(""),
      text: `Sign in: ${url}\n\nThis link can be used once and expires in 5 minutes.\nIf you didn't request this, you can ignore this email.\n`,
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
      subject: `${inviterName} invited you to ${restaurantName} on Tablepass`,
      html: [
        `<p>${inviterName} invited you to join <strong>${restaurantName}</strong> on Tablepass as ${roleLabel}.</p>`,
        `<p><a href="${url}">Accept the invitation</a></p>`,
        "<p>Signing in with this email address accepts the invitation. The link expires in 7 days.</p>",
        "<p>If you weren't expecting this, you can ignore this email.</p>",
      ].join(""),
      text: `${inviterName} invited you to join ${restaurantName} on Tablepass as ${roleLabel}.\n\nAccept: ${url}\n\nSigning in with this email address accepts the invitation. The link expires in 7 days.\n`,
    }),
  });

  if (!response.ok) {
    // Provider status only — no credentials, no response body, no stack.
    console.error(`[auth] Resend invitation send failed with status ${response.status}`);
    throw new Error("Failed to send invitation email");
  }
}
