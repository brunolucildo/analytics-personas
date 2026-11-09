import { EmailService } from "../../email";
import { baseLogger } from "../../../observability/logger";
import type { PasswordResetEmail, PasswordResetMailer } from "../domain/password-reset-ports";
import { buildPasswordResetEmail } from "./password-reset-email";

interface MailLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Sends the password reset e-mail through the shared `EmailService`, with
 * `dispatch` (fire-and-forget): the request does not wait for the provider, so
 * neither a failure nor the delivery time shows in the response. Delivery
 * failures are logged by the service without PII.
 */
export class EmailServicePasswordResetMailer implements PasswordResetMailer {
  constructor(
    private readonly emails: Pick<EmailService, "dispatch">,
    /** Origin of the SPA (`APP_URL`), used to build the reset link. */
    private readonly appUrl: string,
    private readonly logger: MailLogger = baseLogger,
  ) {}

  async sendPasswordReset({ to, firstName, token }: PasswordResetEmail): Promise<void> {
    try {
      const link = `${this.appUrl}/auth/reset-password?token=${encodeURIComponent(token)}`;

      await this.emails.dispatch(buildPasswordResetEmail({ to, firstName, link }));
    } catch {
      // Never rethrow: the response must be the same whether the mail was handed over or not.
      this.logger.error({ event: "password_reset_email_failed" }, "password_reset_email_failed");
    }
  }
}
