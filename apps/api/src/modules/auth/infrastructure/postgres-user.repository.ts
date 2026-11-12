import { sqlStateOf } from "../../../common/sql-state";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import type {
  ConfirmationToken,
  CreateUserResult,
  NewUser,
  UserRepository,
} from "../domain/auth-ports";
import { DataAccessError } from "./data-access-error";

const OPERATION = "auth_sign_up";
const CALL = { operation: "rpc", procedure: OPERATION } as const;

/**
 * `UserRepository` over Postgres. The atomic part (user + token in one
 * transaction, with the unique e-mail deciding races) is the SQL function
 * `auth_sign_up`, called with `SELECT` so the database does the whole job.
 */
export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createWithConfirmationToken(
    user: NewUser,
    token: ConfirmationToken,
  ): Promise<CreateUserResult> {
    let rows: Array<{ user_id: string | null }>;

    try {
      const result = await this.database.query<{ user_id: string | null }>(
        CALL,
        "select public.auth_sign_up($1, $2, $3, $4, $5, $6) as user_id",
        [
          user.firstName,
          user.lastName,
          user.email,
          user.passwordHash,
          token.tokenHash,
          token.expiresAt.toISOString(),
        ],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError(OPERATION, sqlStateOf(error));
    }

    if (rows.length !== 1) {
      throw new DataAccessError(OPERATION, "UNEXPECTED_RESULT");
    }

    const userId = rows[0]?.user_id;

    if (userId === null) {
      return { status: "email_taken" };
    }

    if (typeof userId !== "string") {
      throw new DataAccessError(OPERATION, "UNEXPECTED_RESULT");
    }

    return { status: "created", userId };
  }
}
