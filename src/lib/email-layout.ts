/**
 * Shared branded layout for Eateryo emails (server-only).
 *
 * All bodies use table layout + inline styles (email-client safe),
 * system fonts only, max ~520px. Logo is the "E" in a rounded amber
 * square (#b45309), matching site-header.tsx + icon.svg.
 */

/** Escape user-controlled text interpolated into email HTML. */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const OUTER_BG = "#f5f4f2";
const CARD_BG = "#ffffff";
const CARD_BORDER = "#e7e5e4";
const INK = "#1c1917";
const BODY_TEXT = "#44403c";
const MUTED = "#78716c";
const FAINT = "#a8a29e";
const AMBER = "#b45309";
const AMBER_BG = "#fef3c7";
const AMBER_BORDER = "#fde68a";
const AMBER_DARK = "#92400e";

/** Centered "E" mark used in every email header. */
export function emailLogoMark(accent: string = AMBER, markColor = "#ffffff"): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td align="center" style="width:48px;height:48px;background:${accent};border-radius:12px;` +
    `font-family:Arial,sans-serif;font-size:26px;font-weight:bold;color:${markColor};line-height:48px">E</td>` +
    `</tr></table>`
  );
}

/** Hidden preheader shown as the inbox preview line. */
function emailPreheader(preheader: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">` +
    `${escapeEmailHtml(preheader)}</div>`
  );
}

function emailFooter(tagline: string): string {
  return (
    `<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:11px;color:${FAINT}">` +
    `&copy; Eateryo &middot; ${escapeEmailHtml(tagline)} &middot; ` +
    `<a href="#" style="color:${FAINT}">Privacy</a> &middot; <a href="#" style="color:${FAINT}">Terms</a></p>`
  );
}

/**
 * Wrap an email card body in the outer background + footer.
 * `cardInner` is the <tr>… rows of the white card.
 */
export function emailPage(options: {
  preheader: string;
  cardInner: string;
  tagline?: string;
}): string {
  const tagline = options.tagline ?? "Free while it lasts";
  return (
    emailPreheader(options.preheader) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:${OUTER_BG};margin:0;padding:0">` +
    `<tr><td align="center" style="padding:28px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="max-width:520px;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden">` +
    options.cardInner +
    `</table>` +
    emailFooter(tagline) +
    `</td></tr></table>`
  );
}

/** Primary amber call-to-action button (with Outlook VML fallback). */
export function emailCtaButton(label: string, url: string): string {
  const safeUrl = escapeEmailHtml(url);
  const safeLabel = escapeEmailHtml(label);
  return (
    `<!--[if mso]><v:roundrect href="${safeUrl}" style="width:240px;height:48px" ` +
    `arcsize="25%" fillcolor="${AMBER}" stroke="f">` +
    `<center style="color:#ffffff;font-family:Arial;font-size:16px;font-weight:bold">${safeLabel}</center>` +
    `</v:roundrect><![endif]--><!--[if !mso]><!-- -->` +
    `<a href="${safeUrl}" style="display:inline-block;background:${AMBER};color:#ffffff;` +
    `text-decoration:none;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;` +
    `padding:14px 40px;border-radius:12px">${safeLabel}</a><!--<![endif]-->`
  );
}

/** Small paste-able fallback link under the button. */
export function emailFallbackLink(url: string): string {
  const safeUrl = escapeEmailHtml(url);
  return (
    `<p style="margin:12px 0 0;font-size:12px;word-break:break-all">` +
    `<a href="${safeUrl}" style="color:${AMBER};text-decoration:underline">${safeUrl}</a></p>`
  );
}

export const EMAIL_COLORS = {
  INK,
  BODY_TEXT,
  MUTED,
  FAINT,
  AMBER,
  AMBER_BG,
  AMBER_BORDER,
  AMBER_DARK,
  CARD_BORDER,
};
