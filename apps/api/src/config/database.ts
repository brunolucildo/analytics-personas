import type { PoolConfig } from "pg";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

const SSL_MODES = new Set(["disable", "require", "verify-ca", "verify-full"]);

/**
 * Validates the shape of `DATABASE_URL` without ever echoing the value: the
 * message names the variable and the `.env.example`, never the URL or password.
 */
export function parseDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "DATABASE_URL must be set to the Postgres connection URL. " +
        "Copy .env.example to .env at the repository root and run `bun run infra:up`.",
    );
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid postgres:// or postgresql:// URL.");
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    throw new Error("DATABASE_URL must start with postgres:// or postgresql://.");
  }

  if (!url.hostname) {
    throw new Error("DATABASE_URL must include a host, for example localhost:5432.");
  }

  if (url.pathname.replace(/^\//, "") === "") {
    throw new Error("DATABASE_URL must include the database name, for example /rondo.");
  }

  const sslMode = url.searchParams.get("sslmode");

  if (sslMode !== null && !SSL_MODES.has(sslMode)) {
    throw new Error(
      "DATABASE_URL has an unsupported sslmode. Use disable, require, verify-ca or verify-full.",
    );
  }

  return value;
}

/**
 * TLS from `sslmode`, with libpq semantics: `require` encrypts without checking
 * the certificate; `verify-ca`/`verify-full` check it. Absent or `disable` means
 * no TLS.
 */
export function sslForDatabaseUrl(databaseUrl: string): PoolConfig["ssl"] {
  const sslMode = new URL(databaseUrl).searchParams.get("sslmode");

  switch (sslMode) {
    case null:
    case "disable":
      return undefined;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-ca":
    case "verify-full":
      return { rejectUnauthorized: true };
    default:
      // parseDatabaseUrl already rejects an unknown mode.
      return undefined;
  }
}

const POOL_MAX = 10;
const CONNECTION_TIMEOUT_MS = 5000;
const IDLE_TIMEOUT_MS = 30000;

export function createPostgresPoolConfig(databaseUrl: string): PoolConfig {
  return {
    connectionString: databaseUrl,
    max: POOL_MAX,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    application_name: "rondo-api",
    ssl: sslForDatabaseUrl(databaseUrl),
  };
}
