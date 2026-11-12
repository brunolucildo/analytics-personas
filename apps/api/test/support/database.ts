import { createHash, randomUUID } from "node:crypto";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

/**
 * Shared handle on the local Postgres for the integration tests.
 *
 * Every query goes through the same Pool and uses `$1..$n` placeholders. The
 * helpers below are the only way a test touches the database, so seed and
 * clean-up stay in one place and no test needs to know the schema by heart.
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
    application_name: "rondo-integration-tests",
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

export async function rows<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  return (await query<Row>(text, values)).rows;
}

/** Fails with an actionable message when the migrations were not applied yet. */
export async function assertMigrationsApplied(): Promise<void> {
  try {
    await query("select 1 from public.users limit 1");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown";

    if (code === "42P01") {
      throw new Error(
        "The `users` table is not available in the local database. " +
          "Run `bun run infra:up` and `bun run db:migrate` from the repository root.",
      );
    }

    throw error;
  }
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.test`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomTokenHash(): string {
  return sha256(randomUUID());
}

/** Removes the users created by a test (tokens and sessions go with them). */
export async function deleteUsersByEmail(emails: readonly string[]): Promise<void> {
  if (emails.length > 0) {
    await query("delete from public.users where email = any($1::text[])", [emails]);
  }
}

/** Removes every user whose address starts with `prefix` (E2E and load test clean-up). */
export async function deleteUsersByEmailPrefix(prefix: string): Promise<number> {
  const result = await query("delete from public.users where email like $1", [`${prefix}%`]);

  return result.rowCount ?? 0;
}

export interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  email_confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TokenRow {
  id: string;
  user_id: string;
  type: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

const USER_COLUMNS = `id, first_name, last_name, email, password_hash, email_confirmed_at,
  created_at, updated_at`;
const TOKEN_COLUMNS = "id, user_id, type, token_hash, expires_at, used_at, created_at";
const SESSION_COLUMNS = "id, user_id, created_at, expires_at, revoked_at";

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const found = await rows<UserRow>(`select ${USER_COLUMNS} from public.users where email = $1`, [
    email,
  ]);

  return found[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const found = await rows<UserRow>(`select ${USER_COLUMNS} from public.users where id = $1`, [id]);

  return found[0] ?? null;
}

export async function listUsersByEmail(email: string): Promise<Array<{ id: string }>> {
  return rows<{ id: string }>("select id from public.users where email = $1", [email]);
}

export interface NewUserRow {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  emailConfirmedAt?: Date | null;
}

/** Inserts a user straight into the table; constraint violations are thrown to the caller. */
export async function insertUser(user: NewUserRow): Promise<{ id: string }> {
  const inserted = await rows<{ id: string }>(
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
  const id = inserted[0]?.id;

  if (id === undefined) {
    throw new Error("Could not insert a user.");
  }

  return { id };
}

export async function updateUserFirstName(id: string, firstName: string): Promise<void> {
  await query("update public.users set first_name = $2 where id = $1", [id, firstName]);
}

export async function deleteUserById(id: string): Promise<void> {
  await query("delete from public.users where id = $1", [id]);
}

export async function listTokensOfUser(userId: string, type?: string): Promise<TokenRow[]> {
  if (type === undefined) {
    return rows<TokenRow>(
      `select ${TOKEN_COLUMNS} from public.auth_tokens where user_id = $1 order by created_at`,
      [userId],
    );
  }

  return rows<TokenRow>(
    `select ${TOKEN_COLUMNS} from public.auth_tokens
      where user_id = $1 and type = $2
      order by created_at`,
    [userId, type],
  );
}

export async function listTokensByHash(tokenHash: string): Promise<TokenRow[]> {
  return rows<TokenRow>(`select ${TOKEN_COLUMNS} from public.auth_tokens where token_hash = $1`, [
    tokenHash,
  ]);
}

export interface NewTokenRow {
  userId: string;
  type: "email_confirmation" | "password_reset";
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
}

export async function insertToken(token: NewTokenRow): Promise<{ id: string }> {
  const inserted = await rows<{ id: string }>(
    `insert into public.auth_tokens (user_id, type, token_hash, expires_at, used_at)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [token.userId, token.type, token.tokenHash, token.expiresAt, token.usedAt ?? null],
  );
  const id = inserted[0]?.id;

  if (id === undefined) {
    throw new Error("Could not insert a token.");
  }

  return { id };
}

export async function listSessionsOfUser(userId: string) {
  return rows<SessionRow>(
    `select ${SESSION_COLUMNS} from public.sessions where user_id = $1 order by created_at desc`,
    [userId],
  );
}

export async function insertSession(
  userId: string,
  expiresAt: Date,
): Promise<{ id: string }> {
  const inserted = await rows<{ id: string }>(
    "insert into public.sessions (user_id, expires_at) values ($1, $2) returning id",
    [userId, expiresAt],
  );
  const id = inserted[0]?.id;

  if (id === undefined) {
    throw new Error("Could not insert a session.");
  }

  return { id };
}

export interface SignUpParams {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  tokenHash: string;
  tokenExpiresAt: Date;
}

/** `auth_sign_up`: the new user id, or null when the e-mail is already registered. */
export async function signUp(params: SignUpParams): Promise<string | null> {
  const result = await rows<{ user_id: string | null }>(
    "select public.auth_sign_up($1, $2, $3, $4, $5, $6) as user_id",
    [
      params.firstName,
      params.lastName,
      params.email,
      params.passwordHash,
      params.tokenHash,
      params.tokenExpiresAt,
    ],
  );

  return result[0]?.user_id ?? null;
}

export interface IssuedSession {
  session_id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export async function issueSession(
  userId: string,
  expiresAt: Date,
): Promise<IssuedSession[]> {
  return rows<IssuedSession>(
    "select session_id, first_name, last_name, email from public.auth_issue_session($1, $2)",
    [userId, expiresAt],
  );
}

export async function confirmAccount(tokenHash: string): Promise<string | null> {
  const result = await rows<{ user_id: string | null }>(
    "select public.auth_confirm_account($1) as user_id",
    [tokenHash],
  );

  return result[0]?.user_id ?? null;
}

export async function resendConfirmation(
  email: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<string | null> {
  const result = await rows<{ first_name: string | null }>(
    "select public.auth_resend_confirmation($1, $2, $3) as first_name",
    [email, tokenHash, expiresAt],
  );

  return result[0]?.first_name ?? null;
}

export async function requestPasswordReset(
  email: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<string | null> {
  const result = await rows<{ first_name: string | null }>(
    "select public.auth_request_password_reset($1, $2, $3) as first_name",
    [email, tokenHash, expiresAt],
  );

  return result[0]?.first_name ?? null;
}

export interface PasswordResetOwnerRow {
  user_id: string;
  first_name: string;
  email: string;
}

export async function resetPassword(
  tokenHash: string,
  passwordHash: string,
): Promise<PasswordResetOwnerRow[]> {
  return rows<PasswordResetOwnerRow>(
    "select user_id, first_name, email from public.auth_reset_password($1, $2)",
    [tokenHash, passwordHash],
  );
}
