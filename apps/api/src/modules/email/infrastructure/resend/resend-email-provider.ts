import type { EmailAddress, EmailMessage } from "../../domain/email-message";
import type { EmailProvider } from "../../domain/email-provider";
import { type FetchFunction, postJson } from "../http-delivery";

const RESEND_URL = "https://api.resend.com/emails";

export interface ResendOptions {
  apiKey: string;
  from: EmailAddress;
}

/** Resend (production). Talks to the HTTP API directly: no SDK dependency. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly options: ResendOptions,
    private readonly fetchFunction: FetchFunction = (input, init) => fetch(input, init),
  ) {}

  deliver(message: EmailMessage, signal: AbortSignal): Promise<void> {
    const { apiKey, from } = this.options;

    return postJson(
      this.fetchFunction,
      RESEND_URL,
      { Authorization: `Bearer ${apiKey}` },
      {
        from: from.name ? `${from.name} <${from.address}>` : from.address,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      signal,
    );
  }
}
