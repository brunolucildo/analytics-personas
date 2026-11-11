import { SessionUserNotFoundError } from "../../domain/session-errors";
import type {
  AccessTokenSigner,
  ActiveSession,
  IssuedSession,
  SessionRepository,
} from "../../domain/session-ports";
import { SESSION_TTL_MS } from "../../domain/session-rules";

/**
 * Issues, validates and revokes sessions. The JWT is only a signed envelope of the
 * session id: validity always comes from the database row, so revoking is immediate
 * and a user has at most one active session (issuing a new one revokes the previous).
 */
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly signer: AccessTokenSigner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Starts a session for an existing user. Callers decide whether the user may sign in. */
  async issue(userId: string): Promise<IssuedSession> {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_TTL_MS);
    const created = await this.sessions.issue(userId, expiresAt);

    if (created === null) {
      throw new SessionUserNotFoundError();
    }

    const accessToken = await this.signer.sign(
      { sub: userId, sid: created.sessionId },
      issuedAt,
      expiresAt,
    );

    return { accessToken, expiresAt, user: created.user };
  }

  /** `null` when the session does not exist, was revoked or expired. */
  async validate(sessionId: string): Promise<ActiveSession | null> {
    const stored = await this.sessions.findById(sessionId);

    if (stored === null || stored.revokedAt !== null || stored.expiresAt <= this.now()) {
      return null;
    }

    return { sessionId: stored.id, userId: stored.user.id, user: stored.user };
  }

  /**
   * Resolves the session behind a bearer token, or `null` for any problem with it
   * (the caller must not tell the reasons apart). A database failure is not a
   * "no": it throws, so an outage never looks like a signed-out user.
   */
  async authenticate(token: string): Promise<ActiveSession | null> {
    const claims = await this.signer.verify(token);

    if (claims === null) {
      return null;
    }

    const session = await this.validate(claims.sid);

    return session !== null && session.userId === claims.sub ? session : null;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
