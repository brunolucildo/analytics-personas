import { type EmailMessage, html, renderEmailLayout } from "../../email";

export const CONFIRMATION_EMAIL_PURPOSE = "sign_up_confirmation";

export interface ConfirmationEmailInput {
  to: string;
  firstName: string;
  /** Absolute link to the confirm-account page, token included. */
  link: string;
}

/** Account confirmation e-mail (en-US), HTML and plain text with the same link. */
export function buildConfirmationEmail({
  to,
  firstName,
  link,
}: ConfirmationEmailInput): EmailMessage {
  const subject = "Confirm your email address";
  const { html: document, text } = renderEmailLayout({
    title: subject,
    preheader: "Confirm your email to finish creating your account.",
    bodyHtml: html`<p style="margin:0 0 16px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;">
        Thanks for creating your account. Confirm your email address to finish setting it up.
      </p>
      <p style="margin:0 0 24px;">
        <a
          href="${link}"
          style="display:inline-block;padding:12px 20px;background-color:#FB6107;color:#0A0A0A;font-weight:bold;text-decoration:none;border:2px solid #0A0A0A;"
          >Confirm email</a
        >
      </p>
      <p style="margin:0 0 16px;">If the button does not work, copy this link into your browser:</p>
      <p style="margin:0 0 16px;word-break:break-all;"><a href="${link}">${link}</a></p>
      <p style="margin:0;">This link expires in 24 hours.</p>`,
    bodyText: [
      `Hi ${firstName},`,
      "Thanks for creating your account. Confirm your email address to finish setting it up:",
      link,
      "This link expires in 24 hours.",
    ].join("\n\n"),
  });

  return { to, subject, text, html: document, purpose: CONFIRMATION_EMAIL_PURPOSE };
}
