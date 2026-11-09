import { InvalidConfirmationTokenError } from "../domain/auth-errors";
import type { ConfirmationRepository } from "../domain/confirm-account-ports";
import type { IssuedSession } from "../domain/session-ports";
import type { SessionService } from "./session.service";

/** Input already validated at the boundary (DTO): the raw token of the e-mailed link. */
export interface ConfirmAccountCommand {
  token: string;
}

/**
 * Confirms the e-mail behind a link token and signs the person in. The token is
 * consumed atomically by the database (single use, even under concurrency); the
 * session is only started after that, so no session exists without a consumed
 * token. A new session revokes the previous one (one active session per user).
 */
export class ConfirmAccount {
  constructor(
    private readonly confirmations: ConfirmationRepository,
    private readonly sessions: Pick<SessionService, "issue">,
    /** SHA-256 (hex) of a link token: the only form stored or compared. */
    private readonly hashToken: (token: string) => string,
  ) {}

  async execute(command: ConfirmAccountCommand): Promise<IssuedSession> {
    const userId = await this.confirmations.confirmByTokenHash(this.hashToken(command.token));

    if (userId === null) {
      throw new InvalidConfirmationTokenError();
    }

    return this.sessions.issue(userId);
  }
}
