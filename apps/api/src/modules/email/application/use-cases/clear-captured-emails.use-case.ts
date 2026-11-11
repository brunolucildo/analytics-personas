import type { CapturedEmailRepository } from "../../domain/captured-emails-ports";

/** Empties the mailbox kept by the `capture` provider. Test support only. */
export class ClearCapturedEmails {
  constructor(private readonly emails: CapturedEmailRepository) {}

  execute(): void {
    this.emails.clear();
  }
}
