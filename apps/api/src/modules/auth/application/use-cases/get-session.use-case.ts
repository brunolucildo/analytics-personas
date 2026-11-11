import type { ActiveSession, SessionUser } from "../../domain/session-ports";

/**
 * The user behind the current session. The `AuthGuard` has already validated the token and the
 * session row, so this only answers with the user it resolved; it never touches the database.
 */
export class GetSession {
  execute(session: ActiveSession): SessionUser {
    return session.user;
  }
}
