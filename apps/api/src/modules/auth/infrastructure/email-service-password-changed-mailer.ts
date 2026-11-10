import { EmailService } from "../../email";
import { baseLogger } from "../../../observability/logger";
import type { PasswordChangedEmail, PasswordChangedMailer } from "../domain/password-reset-ports";
import { buildPasswordChangedEmail } from "./password-changed-email";

interface MailLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Sends the "password changed" notice through the shared `EmailService` with `dispatch`
 * (fire-and-forget): the reset does not wait for the provider, and a failure never reaches the
 * response. Delivery failures are logged by the service without PII.
 */
export class EmailServicePasswordChangedMailer implements PasswordChangedMailer {
  constructor(
    private readonly emails: Pick<EmailService, "dispatch">,
    /** Origin of the SPA (`APP_URL`), used to build the forgot-password link. */
    private readonly appUrl: string,
    private readonly logger: MailLogger = baseLogger,
  ) {}

  async sendPasswordChanged({ to, firstName, changedAt }: PasswordChangedEmail): Promise<void> {
    try {
      await this.emails.dispatch(
        buildPasswordChangedEmail({
          to,
          firstName,
          changedAt,
          forgotPasswordUrl: `${this.appUrl}/auth/forgot-password`,
        }),
      );
    } catch {
      this.logger.error(
        { event: "password_changed_email_failed" },
        "password_changed_email_failed",
      );
    }
  }
}
