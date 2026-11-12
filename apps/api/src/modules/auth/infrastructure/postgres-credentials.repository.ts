import { sqlStateOf } from "../../../common/sql-state";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import type { CredentialsRepository, StoredCredentials } from "../domain/sign-in-ports";
import { DataAccessError } from "./data-access-error";

const OPERATION = "find_credentials";

/** `CredentialsRepository` over Postgres: one read of `users`. */
export class PostgresCredentialsRepository implements CredentialsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findByEmail(email: string): Promise<StoredCredentials | null> {
    let rows: Array<Record<string, unknown>>;

    try {
      const result = await this.database.query<Record<string, unknown>>(
        { operation: "select", collection: "users" },
        "select id, password_hash, email_confirmed_at from public.users where email = $1",
        [email],
      );

      rows = result.rows;
    } catch (error) {
      throw new DataAccessError(OPERATION, sqlStateOf(error));
    }

    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    if (
      rows.length !== 1 ||
      typeof row.id !== "string" ||
      typeof row.password_hash !== "string" ||
      (row.email_confirmed_at !== null && !(row.email_confirmed_at instanceof Date))
    ) {
      throw new DataAccessError(OPERATION, "UNEXPECTED_RESULT");
    }

    return {
      userId: row.id,
      passwordHash: row.password_hash,
      emailConfirmed: row.email_confirmed_at !== null,
    };
  }
}
