import type { TokenGenerator } from "../../domain/auth-ports";
import { PASSWORD_RESET_TOKEN_TTL_MS } from "../../domain/auth-rules";
import type {
  PasswordResetMailer,
  PasswordResetRepository,
} from "../../domain/password-reset-ports";

/** Input already validated and normalized at the boundary (DTO). */
export interface RequestPasswordResetCommand {
  email: string;
}

/**
 * Starts a password reset. Only a confirmed account gets a token and an e-mail;
 * an unknown or unconfirmed address ends the same way, with no side effect. The
 * method returns nothing on purpose: the caller cannot tell the branches apart.
 * The mail goes out only after the token is committed.
 */
export class RequestPasswordReset {
  constructor(
    private readonly resets: PasswordResetRepository,
    private readonly tokens: TokenGenerator,
    private readonly mailer: PasswordResetMailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: RequestPasswordResetCommand): Promise<void> {
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = new Date(this.now().getTime() + PASSWORD_RESET_TOKEN_TTL_MS);

    const result = await this.resets.createForConfirmedUser(command.email, {
      tokenHash,
      expiresAt,
    });

    if (result.status === "no_action") {
      return;
    }

    await this.mailer.sendPasswordReset({
      to: command.email,
      firstName: result.firstName,
      token,
    });
  }
}
