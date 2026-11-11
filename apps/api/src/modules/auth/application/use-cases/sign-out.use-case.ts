import type { SessionService } from "../services/session.service";

/**
 * Ends the session behind the current request. Revoking is idempotent, so the call
 * is safe to repeat; only the given session is touched, never the user's others.
 */
export class SignOut {
  constructor(private readonly sessions: Pick<SessionService, "revoke">) {}

  async execute(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
