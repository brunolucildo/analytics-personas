import { EmailService } from "../../email";
import { baseLogger } from "../../../observability/logger";
import type { NewSessionEmail, NewSessionMailer } from "../domain/sign-in-ports";
import { buildNewSessionEmail } from "./new-session-email";

interface MailLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/**
 * Sends the "new sign-in" notice through the shared `EmailService` with `dispatch`
 * (fire-and-forget): the sign-in does not wait for the provider, and a failure never
 * reaches the response. Delivery failures are logged by the service without PII.
 */
export class EmailServiceNewSessionMailer implements NewSessionMailer {
  constructor(
    private readonly emails: Pick<EmailService, "dispatch">,
    /** Origin of the SPA (`APP_URL`), used to build the forgot-password link. */
    private readonly appUrl: string,
    private readonly logger: MailLogger = baseLogger,
  ) {}

  async sendNewSession({ to, firstName, signedInAt }: NewSessionEmail): Promise<void> {
    try {
      await this.emails.dispatch(
        buildNewSessionEmail({
          to,
          firstName,
          signedInAt,
          forgotPasswordUrl: `${this.appUrl}/auth/forgot-password`,
        }),
      );
    } catch {
      this.logger.error({ event: "new_session_email_failed" }, "new_session_email_failed");
    }
  }
}
