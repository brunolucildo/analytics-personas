import type { CapturedEmail, CapturedEmailRepository } from "../../domain/captured-emails-ports";

/** Optional recipient filter of `GET /api/v1/test-support/emails?to=`. */
export interface ListCapturedEmailsCommand {
  to?: string;
}

/** Lists the messages kept by the `capture` provider. Test support only. */
export class ListCapturedEmails {
  constructor(private readonly emails: CapturedEmailRepository) {}

  execute(command: ListCapturedEmailsCommand = {}): CapturedEmail[] {
    return this.emails.list({ to: command.to });
  }
}
