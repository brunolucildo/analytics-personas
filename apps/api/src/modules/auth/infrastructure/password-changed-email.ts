import { type EmailMessage, html, renderEmailLayout } from "../../email";
import { formatUtc } from "./new-session-email";

export const PASSWORD_CHANGED_EMAIL_PURPOSE = "password_changed";

export interface PasswordChangedEmailInput {
  to: string;
  firstName: string;
  changedAt: Date;
  /** Absolute link to the forgot-password page. */
  forgotPasswordUrl: string;
}

/**
 * "Password changed" notice (en-US), HTML and plain text. It carries only the time of the change:
 * never the password, a token or any address data. The layout footer says readers can ignore the
 * message, so the body says outright that a change that was not theirs must not be ignored.
 */
export function buildPasswordChangedEmail({
  to,
  firstName,
  changedAt,
  forgotPasswordUrl,
}: PasswordChangedEmailInput): EmailMessage {
  const subject = "Your Rondo password was changed";
  const when = formatUtc(changedAt);
  const { html: document, text } = renderEmailLayout({
    title: subject,
    preheader: "Your password was just changed.",
    bodyHtml: html`<p style="margin:0 0 16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">Your password was changed on ${when}.</p>
      <p style="margin:0 0 16px;">All your sessions were signed out.</p>
      <p style="margin:0 0 16px;">
        If you didn't do this, reset your password again right away. Don't ignore this message:
        <a href="${forgotPasswordUrl}">${forgotPasswordUrl}</a>
      </p>`,
    bodyText: [
      `Hi ${firstName},`,
      `Your password was changed on ${when}.`,
      "All your sessions were signed out.",
      `If you didn't do this, reset your password again right away. Don't ignore this message: ${forgotPasswordUrl}`,
    ].join("\n\n"),
  });

  return { to, subject, text, html: document, purpose: PASSWORD_CHANGED_EMAIL_PURPOSE };
}
