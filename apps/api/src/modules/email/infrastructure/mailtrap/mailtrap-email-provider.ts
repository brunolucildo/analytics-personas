import type { EmailAddress, EmailMessage } from "../../domain/email-message";
import type { EmailProvider } from "../../domain/email-provider";
import { type FetchFunction, postJson } from "../http-delivery";

const MAILTRAP_SANDBOX_URL = "https://sandbox.api.mailtrap.io/api/send";

export interface MailtrapOptions {
  apiToken: string;
  inboxId: string;
  from: EmailAddress;
}

/**
 * Mailtrap Email Sandbox (non-production): the message lands in the Mailtrap
 * inbox and never reaches the recipient.
 */
export class MailtrapEmailProvider implements EmailProvider {
  readonly name = "mailtrap";

  constructor(
    private readonly options: MailtrapOptions,
    private readonly fetchFunction: FetchFunction = (input, init) => fetch(input, init),
  ) {}

  deliver(message: EmailMessage, signal: AbortSignal): Promise<void> {
    const { apiToken, inboxId, from } = this.options;

    return postJson(
      this.fetchFunction,
      `${MAILTRAP_SANDBOX_URL}/${encodeURIComponent(inboxId)}`,
      { Authorization: `Bearer ${apiToken}` },
      {
        from: { email: from.address, ...(from.name ? { name: from.name } : {}) },
        to: [{ email: message.to }],
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      signal,
    );
  }
}
