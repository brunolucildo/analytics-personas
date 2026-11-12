import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * Shared handle on the local Postgres for the end-to-end tests.
 *
 * The E2E specs seed and clean up data directly, so they need the same database
 * the API under test uses. Every statement goes through this Pool with `$1..$n`
 * placeholders; `DATABASE_URL` is the only connection setting.
 */

let pool: Pool | undefined;

export function databasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Run `bun run infra:up` and `bun run db:migrate` " +
        "from the repository root, with .env copied from .env.example.",
    );
  }

  pool ??= new Pool({
    connectionString,
    max: 4,
    application_name: "rondo-e2e",
    connectionTimeoutMillis: 5000,
  });

  return pool;
}

export async function closeDatabasePool(): Promise<void> {
  await pool?.end().catch(() => undefined);
  pool = undefined;
}

export function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  return databasePool().query<Row>(text, values as unknown[]);
}

/** Removes every user whose address starts with `prefix` (tokens and sessions cascade). */
export async function deleteUsersByEmailPrefix(prefix: string): Promise<number> {
  const result = await query("delete from public.users where email like $1", [`${prefix}%`]);

  return result.rowCount ?? 0;
}

export interface NewUser {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  emailConfirmedAt?: Date | null;
}

export async function insertUser(user: NewUser): Promise<string> {
  const result = await query<{ id: string }>(
    `insert into public.users (first_name, last_name, email, password_hash, email_confirmed_at)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      user.firstName,
      user.lastName,
      user.email,
      user.passwordHash,
      user.emailConfirmedAt ?? null,
    ],
  );
  const id = result.rows[0]?.id;

  if (id === undefined) {
    throw new Error("Could not seed a user.");
  }

  return id;
}

export async function insertConfirmationToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `insert into public.auth_tokens (user_id, type, token_hash, expires_at)
     values ($1, 'email_confirmation', $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

/** `auth_issue_session`: returns the new session id, revoking the previous one. */
export async function issueSession(userId: string, expiresAt: Date): Promise<string> {
  const result = await query<{ session_id: string }>(
    "select session_id from public.auth_issue_session($1, $2)",
    [userId, expiresAt.toISOString()],
  );
  const sessionId = result.rows[0]?.session_id;

  if (sessionId === undefined) {
    throw new Error("Could not issue a session for the seeded user.");
  }

  return sessionId;
}
