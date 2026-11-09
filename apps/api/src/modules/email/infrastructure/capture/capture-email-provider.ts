import type { EmailAddress, EmailMessage } from "../../domain/email-message";
import type { EmailProvider } from "../../domain/email-provider";
import type { CapturedEmailStore } from "./captured-email-store";

/** Keeps messages in memory; nothing leaves the process. */
export class CaptureEmailProvider implements EmailProvider {
  readonly name = "capture";

  constructor(
    private readonly from: EmailAddress,
    private readonly store: CapturedEmailStore,
  ) {}

  async deliver(message: EmailMessage): Promise<void> {
    this.store.add({ ...message, from: this.from, capturedAt: new Date().toISOString() });
  }
}
