import type { PasswordHasher } from "../domain/auth-ports";
import { InvalidPasswordResetTokenError } from "../domain/auth-errors";
import type {
  PasswordChangedMailer,
  PasswordResetRepository,
} from "../domain/password-reset-ports";

/** Input already validated at the boundary (DTO): the raw token of the e-mailed link and the new password. */
export interface ResetPasswordCommand {
  token: string;
  password: string;
}

/**
 * Changes the password behind a reset link token. The hash is computed first (so a bad token
 * costs the same as a good one) and handed to the database, which consumes the token, stores the
 * hash and revokes every session in one transaction (single use, even under concurrency). No
 * session is opened. The "password changed" notice goes out only after that, never before.
 */
export class ResetPassword {
  constructor(
    private readonly resets: Pick<PasswordResetRepository, "resetByTokenHash">,
    private readonly hasher: PasswordHasher,
    private readonly mailer: PasswordChangedMailer,
    /** SHA-256 (hex) of a link token: the only form stored or compared. */
    private readonly hashToken: (token: string) => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: ResetPasswordCommand): Promise<void> {
    const passwordHash = await this.hasher.hash(command.password);
    const owner = await this.resets.resetByTokenHash(this.hashToken(command.token), passwordHash);

    if (owner === null) {
      throw new InvalidPasswordResetTokenError();
    }

    await this.mailer.sendPasswordChanged({
      to: owner.email,
      firstName: owner.firstName,
      changedAt: this.now(),
    });
  }
}
