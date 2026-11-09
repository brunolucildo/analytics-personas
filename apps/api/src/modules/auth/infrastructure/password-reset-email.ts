import { type EmailMessage, html, renderEmailLayout } from "../../email";

export const PASSWORD_RESET_EMAIL_PURPOSE = "password_reset";

export interface PasswordResetEmailInput {
  to: string;
  firstName: string;
  /** Absolute link to the reset-password page, token included. */
  link: string;
}

/** Password reset e-mail (en-US), HTML and plain text with the same link. */
export function buildPasswordResetEmail({
  to,
  firstName,
  link,
}: PasswordResetEmailInput): EmailMessage {
  const subject = "Reset your Analytics Personas password";
  const { html: document, text } = renderEmailLayout({
    title: subject,
    preheader: "Use this link to choose a new password.",
    bodyHtml: html`<p style="margin:0 0 16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">
        We received a request to reset your password. Use the button below to choose a new one.
      </p>
      <p style="margin:0 0 24px;">
        <a
          href="${link}"
          style="display:inline-block;padding:12px 20px;background-color:#FB6107;color:#0A0A0A;font-weight:bold;text-decoration:none;border:2px solid #0A0A0A;"
          >Reset password</a
        >
      </p>
      <p style="margin:0 0 16px;">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0 0 16px;word-break:break-all;"><a href="${link}">${link}</a></p>
      <p style="margin:0 0 16px;">This link expires in 1 hour.</p>
      <p style="margin:0;">If you didn't request this, you can ignore this email.</p>`,
    bodyText: [
      `Hi ${firstName},`,
      "We received a request to reset your password. Use this link to choose a new one:",
      link,
      "This link expires in 1 hour.",
      "If you didn't request this, you can ignore this email.",
    ].join("\n\n"),
  });

  return { to, subject, text, html: document, purpose: PASSWORD_RESET_EMAIL_PURPOSE };
}
