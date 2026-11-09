import { type EmailMessage, html, renderEmailLayout } from "../../email";

export const NEW_SESSION_EMAIL_PURPOSE = "new_session";

export interface NewSessionEmailInput {
  to: string;
  firstName: string;
  signedInAt: Date;
  /** Absolute link to the forgot-password page. */
  forgotPasswordUrl: string;
}

/** `2026-11-09 19:15 UTC`: no locale or time zone surprises, and nothing about the device. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * "New sign-in" notice (en-US), HTML and plain text. It carries only the time of the sign-in:
 * the system does not collect IP, device or location.
 */
export function buildNewSessionEmail({
  to,
  firstName,
  signedInAt,
  forgotPasswordUrl,
}: NewSessionEmailInput): EmailMessage {
  const subject = "New sign-in to Analytics Personas";
  const when = formatUtc(signedInAt);
  const { html: document, text } = renderEmailLayout({
    title: subject,
    preheader: "Your account was just signed in to.",
    bodyHtml: html`<p style="margin:0 0 16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">Your account was signed in to on ${when}.</p>
      <p style="margin:0 0 16px;">Any earlier session was signed out.</p>
      <p style="margin:0 0 16px;">
        If this wasn't you, reset your password:
        <a href="${forgotPasswordUrl}">${forgotPasswordUrl}</a>
      </p>`,
    bodyText: [
      `Hi ${firstName},`,
      `Your account was signed in to on ${when}.`,
      "Any earlier session was signed out.",
      `If this wasn't you, reset your password: ${forgotPasswordUrl}`,
    ].join("\n\n"),
  });

  return { to, subject, text, html: document, purpose: NEW_SESSION_EMAIL_PURPOSE };
}
