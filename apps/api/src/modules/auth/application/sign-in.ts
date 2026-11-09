import { EmailNotConfirmedError, InvalidCredentialsError } from "../domain/auth-errors";
import type { IssuedSession } from "../domain/session-ports";
import type {
  CredentialsRepository,
  NewSessionMailer,
  PasswordVerifier,
} from "../domain/sign-in-ports";
import type { SessionService } from "./session.service";

/** Input already validated and normalized at the boundary (DTO). */
export interface SignInCommand {
  email: string;
  password: string;
}

/**
 * Opens a session for a confirmed account that presents the right password. The hash is
 * checked even when the e-mail has no account (same cost, same error), and the account
 * state is only revealed after the password matched. Issuing the session revokes the
 * user's previous one; the "new sign-in" notice goes out after that, never before.
 */
export class SignIn {
  constructor(
    private readonly credentials: CredentialsRepository,
    private readonly verifier: PasswordVerifier,
    private readonly sessions: Pick<SessionService, "issue">,
    private readonly mailer: NewSessionMailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: SignInCommand): Promise<IssuedSession> {
    const stored = await this.credentials.findByEmail(command.email);
    const matches = await this.verifier.verify(command.password, stored?.passwordHash ?? null);

    if (stored === null || !matches) {
      throw new InvalidCredentialsError();
    }

    if (!stored.emailConfirmed) {
      throw new EmailNotConfirmedError();
    }

    const session = await this.sessions.issue(stored.userId);

    await this.mailer.sendNewSession({
      to: session.user.email,
      firstName: session.user.firstName,
      signedInAt: this.now(),
    });

    return session;
  }
}
