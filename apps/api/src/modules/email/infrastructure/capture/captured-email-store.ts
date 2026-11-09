import type { EmailAddress, EmailMessage } from "../../domain/email-message";

export interface CapturedEmail extends EmailMessage {
  from: EmailAddress;
  capturedAt: string;
}

const MAX_CAPTURED_EMAILS = 500;

/** In-memory mailbox of the `capture` provider. Never used outside tests. */
export class CapturedEmailStore {
  private emails: CapturedEmail[] = [];

  add(email: CapturedEmail): void {
    this.emails.push(email);

    if (this.emails.length > MAX_CAPTURED_EMAILS) {
      this.emails.splice(0, this.emails.length - MAX_CAPTURED_EMAILS);
    }
  }

  list(filter: { to?: string } = {}): CapturedEmail[] {
    const to = filter.to?.trim().toLowerCase();

    return this.emails
      .filter((email) => to === undefined || email.to.toLowerCase() === to)
      .map((email) => ({ ...email }));
  }

  clear(): void {
    this.emails = [];
  }
}

/** Shared mailbox: the provider writes to it and test helpers read from it. */
export const capturedEmailStore = new CapturedEmailStore();

/** Test helper: messages captured so far, optionally for one recipient. */
export function getCapturedEmails(filter: { to?: string } = {}): CapturedEmail[] {
  return capturedEmailStore.list(filter);
}

export function clearCapturedEmails(): void {
  capturedEmailStore.clear();
}
