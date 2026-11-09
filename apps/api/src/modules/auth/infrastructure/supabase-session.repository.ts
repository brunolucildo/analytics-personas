import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreatedSession,
  SessionRepository,
  SessionUser,
  StoredSession,
} from "../domain/session-ports";
import { DataAccessError } from "./data-access-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDate(value: unknown): Date | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
}

/**
 * `SessionRepository` over Supabase. Starting a session (revoke the previous one
 * and insert the new one) is the SQL function `auth_issue_session`, called through
 * RPC with the service role; reading and revoking are single statements.
 */
export class SupabaseSessionRepository implements SessionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async issue(userId: string, expiresAt: Date): Promise<CreatedSession | null> {
    const { data, error } = await this.client.rpc("auth_issue_session", {
      p_user_id: userId,
      p_expires_at: expiresAt.toISOString(),
    });

    if (error) {
      throw new DataAccessError("auth_issue_session", error.code);
    }

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const row: unknown = data[0];

    if (
      !isRecord(row) ||
      typeof row.session_id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      typeof row.email !== "string"
    ) {
      throw new DataAccessError("auth_issue_session", "UNEXPECTED_RESULT");
    }

    return {
      sessionId: row.session_id,
      user: { id: userId, firstName: row.first_name, lastName: row.last_name, email: row.email },
    };
  }

  async findById(sessionId: string): Promise<StoredSession | null> {
    const { data, error } = await this.client
      .from("sessions")
      .select("id, expires_at, revoked_at, users!inner(id, first_name, last_name, email)")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      throw new DataAccessError("find_session", error.code);
    }

    if (data === null) {
      return null;
    }

    const row: unknown = data;
    const joined = isRecord(row) ? row.users : undefined;
    const owner: unknown = Array.isArray(joined) ? joined[0] : joined;
    const expiresAt = isRecord(row) ? toDate(row.expires_at) : null;

    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      expiresAt === null ||
      !isRecord(owner) ||
      typeof owner.id !== "string" ||
      typeof owner.first_name !== "string" ||
      typeof owner.last_name !== "string" ||
      typeof owner.email !== "string"
    ) {
      throw new DataAccessError("find_session", "UNEXPECTED_RESULT");
    }

    const user: SessionUser = {
      id: owner.id,
      firstName: owner.first_name,
      lastName: owner.last_name,
      email: owner.email,
    };

    return { id: row.id, expiresAt, revokedAt: toDate(row.revoked_at), user };
  }

  async revoke(sessionId: string): Promise<void> {
    const { error } = await this.client
      .from("sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("revoked_at", null);

    if (error) {
      throw new DataAccessError("revoke_session", error.code);
    }
  }
}
