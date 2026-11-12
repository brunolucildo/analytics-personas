import { sqlStateOf } from "../../../common/sql-state";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import type {
  PasswordResetOwner,
  PasswordResetRepository,
  PasswordResetToken,
  RequestPasswordResetResult,
} from "../domain/password-reset-ports";
import { DataAccessError } from "./data-access-error";

/**
 * `PasswordResetRepository` over Postgres. The atomic part (confirmed account
 * lookup, invalidation of the earlier tokens and the insert of the new one) lives
 * in the SQL function `auth_request_password_reset`; consuming the token and
 * changing the password live in `auth_reset_password`.
 */
export class PostgresPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createForConfirmedUser(
    email: string,
    token: PasswordResetToken,
  ): Promise<RequestPasswordResetResult> {
    let rows: Array<{ first_name: string | null }>;

    try {
      const result = await this.database.query<{ first_name: string | null }>(
        { operation: "rpc", procedure: "auth_request_password_reset" },
        "select public.auth_request_password_reset($1, $2, $3) as first_name",
        [email, token.tokenHash, token.expiresAt.toISOString()],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError("auth_request_password_reset", sqlStateOf(error));
    }

    if (rows.length !== 1) {
      throw new DataAccessError("auth_request_password_reset", "UNEXPECTED_RESULT");
    }

    const firstName = rows[0]?.first_name;

    if (firstName === null) {
      return { status: "no_action" };
    }

    if (typeof firstName !== "string") {
      throw new DataAccessError("auth_request_password_reset", "UNEXPECTED_RESULT");
    }

    return { status: "created", firstName };
  }

  async resetByTokenHash(
    tokenHash: string,
    passwordHash: string,
  ): Promise<PasswordResetOwner | null> {
    let rows: Array<Record<string, unknown>>;

    try {
      const result = await this.database.query<Record<string, unknown>>(
        { operation: "rpc", procedure: "auth_reset_password" },
        "select user_id, first_name, email from public.auth_reset_password($1, $2)",
        [tokenHash, passwordHash],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError("auth_reset_password", sqlStateOf(error));
    }

    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    if (
      rows.length !== 1 ||
      typeof row.user_id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.email !== "string"
    ) {
      throw new DataAccessError("auth_reset_password", "UNEXPECTED_RESULT");
    }

    return { userId: row.user_id, firstName: row.first_name, email: row.email };
  }
}
