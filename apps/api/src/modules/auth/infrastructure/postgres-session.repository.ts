import { sqlStateOf } from "../../../common/sql-state";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import type {
  CreatedSession,
  SessionRepository,
  SessionUser,
  StoredSession,
} from "../domain/session-ports";
import { DataAccessError } from "./data-access-error";

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
};

/**
 * `SessionRepository` over Postgres. Starting a session (revoke the previous one
 * and insert the new one) is the SQL function `auth_issue_session`; reading joins
 * `sessions` and `users` explicitly and revoking is a single statement.
 */
export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly database: DatabaseClient) {}

  async issue(userId: string, expiresAt: Date): Promise<CreatedSession | null> {
    let rows: Array<{
      session_id: string;
      first_name: string;
      last_name: string;
      email: string;
    }>;

    try {
      const result = await this.database.query<{
        session_id: string;
        first_name: string;
        last_name: string;
        email: string;
      }>(
        { operation: "rpc", procedure: "auth_issue_session" },
        "select session_id, first_name, last_name, email from public.auth_issue_session($1, $2)",
        [userId, expiresAt.toISOString()],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError("auth_issue_session", sqlStateOf(error));
    }

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    if (
      rows.length !== 1 ||
      row === undefined ||
      typeof row.session_id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      typeof row.email !== "string"
    ) {
      throw new DataAccessError("auth_issue_session", "UNEXPECTED_RESULT");
    }

    return {
      sessionId: row.session_id,
      user: {
        id: userId,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
      },
    };
  }

  async findById(sessionId: string): Promise<StoredSession | null> {
    let rows: Array<Record<string, unknown>>;

    try {
      const result = await this.database.query<Record<string, unknown>>(
        { operation: "select", collection: "sessions" },
        `select s.id, s.expires_at, s.revoked_at,
                u.id as user_id, u.first_name, u.last_name, u.email
           from public.sessions s
           join public.users u on u.id = s.user_id
          where s.id = $1`,
        [sessionId],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError("find_session", sqlStateOf(error));
    }

    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    const expiresAt = toDate(row.expires_at);

    if (
      rows.length !== 1 ||
      typeof row.id !== "string" ||
      expiresAt === null ||
      typeof row.user_id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      typeof row.email !== "string"
    ) {
      throw new DataAccessError("find_session", "UNEXPECTED_RESULT");
    }

    const user: SessionUser = {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
    };

    return { id: row.id, expiresAt, revokedAt: toDate(row.revoked_at), user };
  }

  async revoke(sessionId: string): Promise<void> {
    try {
      await this.database.query(
        { operation: "update", collection: "sessions" },
        "update public.sessions set revoked_at = now() where id = $1 and revoked_at is null",
        [sessionId],
      );
    } catch (error) {
      throw new DataAccessError("revoke_session", sqlStateOf(error));
    }
  }
}
