import type { EmailAddress, EmailMessage } from "./email-message";

/** Read model of the `capture` provider: the message plus sender and capture time. */
export interface CapturedEmail extends EmailMessage {
  from: EmailAddress;
  capturedAt: string;
}

/**
 * Port of the captured-mail mailbox used by the test-support routes. The in-memory
 * adapter lives in `infrastructure`; the `interface` layer only knows this contract.
 */
export interface CapturedEmailRepository {
  /** Messages captured so far, optionally for one recipient (filter normalized here). */
  list(filter?: { to?: string }): CapturedEmail[];
  clear(): void;
}
