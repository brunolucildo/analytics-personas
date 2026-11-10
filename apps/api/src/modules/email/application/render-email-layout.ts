import { escapeHtml, type SafeHtml } from "../domain/safe-html";

/** Colors from `.docs/DESIGN.md` §2; text pairs meet WCAG AA (checked in the spec). */
export const EMAIL_COLORS = {
  ink: "#0A0A0A",
  paper: "#FFFDF5",
  muted: "#6B6B6B",
  accent: "#FB6107",
  white: "#FFFFFF",
} as const;

const FONT_STACK = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const PRODUCT_NAME = "Rondo";

export interface EmailLayoutInput {
  /** Becomes the document title and the visible heading. */
  title: string;
  /** Short preview text shown by mail clients next to the subject. */
  preheader: string;
  /** Build with the `html` tag so dynamic values are escaped. */
  bodyHtml: SafeHtml;
  /** Same content as `bodyHtml`, as plain text without markup. */
  bodyText: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Base layout shared by every transactional e-mail (en-US, HTML plus plain
 * text). Title and preheader are escaped here; `bodyHtml` is `SafeHtml`.
 */
export function renderEmailLayout(input: EmailLayoutInput): RenderedEmail {
  const title = escapeHtml(input.title);
  const preheader = escapeHtml(input.preheader);

  const htmlDocument = `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
<style>a { color: ${EMAIL_COLORS.ink}; text-decoration: underline; }</style>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.paper};color:${EMAIL_COLORS.ink};font-family:${FONT_STACK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${EMAIL_COLORS.paper};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLORS.paper};">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:${EMAIL_COLORS.white};border:2px solid ${EMAIL_COLORS.ink};border-top:8px solid ${EMAIL_COLORS.accent};">
<tr><td style="padding:24px;">
<p style="margin:0 0 16px;font-size:16px;font-weight:bold;color:${EMAIL_COLORS.ink};">${PRODUCT_NAME}</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:${EMAIL_COLORS.ink};">${title}</h1>
<div style="font-size:16px;line-height:1.5;color:${EMAIL_COLORS.ink};">${input.bodyHtml.value}</div>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${EMAIL_COLORS.muted};font-size:14px;line-height:1.4;color:${EMAIL_COLORS.muted};">
You received this e-mail because of activity on your ${PRODUCT_NAME} account. If this was not you, you can ignore this message.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  const text = `${input.title}\n\n${input.bodyText.trim()}\n\n--\n${PRODUCT_NAME}\nYou received this e-mail because of activity on your ${PRODUCT_NAME} account. If this was not you, you can ignore this message.\n`;

  return { html: htmlDocument, text };
}
