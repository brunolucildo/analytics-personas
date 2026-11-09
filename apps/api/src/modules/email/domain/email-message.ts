export interface EmailMessage {
  /** Single recipient address. It is PII: never log it. */
  to: string;
  subject: string;
  /** Plain-text alternative. */
  text: string;
  html: string;
  /** Kind of e-mail (for example `sign_up_confirmation`). Safe to log. Defaults to `unspecified`. */
  purpose?: string;
}

export interface EmailAddress {
  address: string;
  name?: string;
}

export const DEFAULT_EMAIL_PURPOSE = "unspecified";
