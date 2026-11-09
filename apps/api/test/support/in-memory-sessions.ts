import { randomUUID } from "node:crypto";
import type {
  CreatedSession,
  SessionRepository,
  SessionUser,
  StoredSession,
} from "../../src/modules/auth/domain/session-ports";

/** In-memory `SessionRepository` for unit tests: same contract as the Supabase one. */
export class InMemorySessionRepository implements SessionRepository {
  readonly sessions: Array<StoredSession & { userId: string }> = [];

  constructor(private readonly users: SessionUser[]) {}

  issue(userId: string, expiresAt: Date): Promise<CreatedSession | null> {
    const user = this.users.find((candidate) => candidate.id === userId);

    if (user === undefined) {
      return Promise.resolve(null);
    }

    for (const session of this.sessions) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = new Date();
      }
    }

    const id = randomUUID();

    this.sessions.push({ id, userId, expiresAt, revokedAt: null, user });

    return Promise.resolve({ sessionId: id, user });
  }

  findById(sessionId: string): Promise<StoredSession | null> {
    return Promise.resolve(this.sessions.find((session) => session.id === sessionId) ?? null);
  }

  revoke(sessionId: string): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);

    if (session !== undefined && session.revokedAt === null) {
      session.revokedAt = new Date();
    }

    return Promise.resolve();
  }
}
