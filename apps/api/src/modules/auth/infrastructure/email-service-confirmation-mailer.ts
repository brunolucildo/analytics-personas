import { EmailService } from "../../email";
import { baseLogger } from "../../../observability/logger";
import type { ConfirmationEmail, ConfirmationMailer } from "../domain/auth-ports";
import { buildConfirmationEmail } from "./confirmation-email";

interface MailLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Sends the confirmation e-mail through the shared `EmailService`, with
 * `dispatch` (fire-and-forget): the sign-up request does not wait for the
 * provider and never fails because of it. Delivery failures are logged by the
 * service without PII.
 */
export class EmailServiceConfirmationMailer implements ConfirmationMailer {
  constructor(
    private readonly emails: Pick<EmailService, "dispatch">,
    /** Origin of the SPA (`APP_URL`), used to build the confirmation link. */
    private readonly appUrl: string,
    private readonly logger: MailLogger = baseLogger,
  ) {}

  async sendConfirmation({ to, firstName, token }: ConfirmationEmail): Promise<void> {
    try {
      const link = `${this.appUrl}/auth/confirm-account?token=${encodeURIComponent(token)}`;

      await this.emails.dispatch(buildConfirmationEmail({ to, firstName, link }));
    } catch {
      // Never rethrow: the account already exists and the user can ask for a resend.
      this.logger.error({ event: "confirmation_email_failed" }, "confirmation_email_failed");
    }
  }
}
