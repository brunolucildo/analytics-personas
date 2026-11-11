import type { ConfirmationMailer, TokenGenerator } from "../../domain/auth-ports";
import { CONFIRMATION_TOKEN_TTL_MS } from "../../domain/auth-rules";
import type { ConfirmationRepository } from "../../domain/confirm-account-ports";

/** Input already validated and normalized at the boundary (DTO). */
export interface ResendConfirmationCommand {
  email: string;
}

/**
 * Sends a new confirmation link. Only an unconfirmed account gets a token and an
 * e-mail (the older links stop working); an unknown or already confirmed address
 * ends the same way, with no side effect. The method returns nothing on purpose:
 * the caller cannot tell the branches apart. The mail goes out only after the
 * token is committed.
 */
export class ResendConfirmation {
  constructor(
    private readonly confirmations: ConfirmationRepository,
    private readonly tokens: TokenGenerator,
    private readonly mailer: ConfirmationMailer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: ResendConfirmationCommand): Promise<void> {
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = new Date(this.now().getTime() + CONFIRMATION_TOKEN_TTL_MS);

    const result = await this.confirmations.renewForUnconfirmedUser(command.email, {
      tokenHash,
      expiresAt,
    });

    if (result.status === "no_action") {
      return;
    }

    await this.mailer.sendConfirmation({
      to: command.email,
      firstName: result.firstName,
      token,
    });
  }
}
