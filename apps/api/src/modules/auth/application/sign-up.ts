import { EmailAlreadyRegisteredError } from "../domain/auth-errors";
import type {
  ConfirmationMailer,
  PasswordHasher,
  TokenGenerator,
  UserRepository,
} from "../domain/auth-ports";
import { CONFIRMATION_TOKEN_TTL_MS } from "../domain/auth-rules";

/** Input already validated and normalized at the boundary (DTO). */
export interface SignUpCommand {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface SignUpResult {
  email: string;
}

/**
 * Creates an unconfirmed account and hands the confirmation e-mail over for
 * delivery. The mail goes out only after the user and token are committed, and
 * a mail failure never undoes the sign-up.
 */
export class SignUp {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokens: TokenGenerator,
    private readonly mailer: ConfirmationMailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: SignUpCommand): Promise<SignUpResult> {
    const passwordHash = await this.passwordHasher.hash(command.password);
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = new Date(this.now().getTime() + CONFIRMATION_TOKEN_TTL_MS);

    const created = await this.users.createWithConfirmationToken(
      {
        firstName: command.firstName,
        lastName: command.lastName,
        email: command.email,
        passwordHash,
      },
      { tokenHash, expiresAt },
    );

    if (created.status === "email_taken") {
      throw new EmailAlreadyRegisteredError();
    }

    await this.mailer.sendConfirmation({
      to: command.email,
      firstName: command.firstName,
      token,
    });

    return { email: command.email };
  }
}
