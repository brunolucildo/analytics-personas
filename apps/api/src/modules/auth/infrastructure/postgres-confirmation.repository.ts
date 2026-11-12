import { sqlStateOf } from "../../../common/sql-state";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import type { ConfirmationToken } from "../domain/auth-ports";
import type {
  ConfirmationRepository,
  RenewConfirmationResult,
} from "../domain/confirm-account-ports";
import { DataAccessError } from "./data-access-error";

/**
 * `ConfirmationRepository` over Postgres. Both operations are SQL functions
 * (`auth_confirm_account` and `auth_resend_confirmation`), so each one runs in a
 * single transaction inside the database.
 */
export class PostgresConfirmationRepository implements ConfirmationRepository {
  constructor(private readonly database: DatabaseClient) {}

  async confirmByTokenHash(tokenHash: string): Promise<string | null> {
    let rows: Array<{ user_id: string | null }>;

    try {
      const result = await this.database.query<{ user_id: string | null }>(
        { operation: "rpc", procedure: "auth_confirm_account" },
        "select public.auth_confirm_account($1) as user_id",
        [tokenHash],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError("auth_confirm_account", sqlStateOf(error));
    }

    if (rows.length !== 1) {
      throw new DataAccessError("auth_confirm_account", "UNEXPECTED_RESULT");
    }

    const userId = rows[0]?.user_id;

    if (userId === null) {
      return null;
    }

    if (typeof userId !== "string") {
      throw new DataAccessError("auth_confirm_account", "UNEXPECTED_RESULT");
    }

    return userId;
  }

  async renewForUnconfirmedUser(
    email: string,
    token: ConfirmationToken,
  ): Promise<RenewConfirmationResult> {
    let rows: Array<{ first_name: string | null }>;

    try {
      const result = await this.database.query<{ first_name: string | null }>(
        { operation: "rpc", procedure: "auth_resend_confirmation" },
        "select public.auth_resend_confirmation($1, $2, $3) as first_name",
        [email, token.tokenHash, token.expiresAt.toISOString()],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError("auth_resend_confirmation", sqlStateOf(error));
    }

    if (rows.length !== 1) {
      throw new DataAccessError("auth_resend_confirmation", "UNEXPECTED_RESULT");
    }

    const firstName = rows[0]?.first_name;

    if (firstName === null) {
      return { status: "no_action" };
    }

    if (typeof firstName !== "string") {
      throw new DataAccessError("auth_resend_confirmation", "UNEXPECTED_RESULT");
    }

    return { status: "created", firstName };
  }
}
