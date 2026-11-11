import { type EmailConfig, parseEmailConfig } from "../modules/email";
import { MIN_JWT_SECRET_LENGTH } from "../modules/auth/domain/session-rules";

export interface Environment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  appUrl: string;
  apiPort: number;
  otelEndpoint: string;
  otelServiceName: string;
  trustProxy: boolean;
  email: EmailConfig;
  /** HS256 secret of the access tokens. Server only: never logged, never in the bundle. */
  authJwtSecret: string;
  /** Password hashes allowed to run at the same time (see `HashLimiter`). */
  authHashConcurrency: number;
  /** Password hashes allowed to wait for a free slot before the API answers 503. */
  authHashQueueLimit: number;
}

const REQUIRED_VARIABLES = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
] as const;

function parseAppOrigin(value: string): string {
  try {
    const url = new URL(value);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin;
    }
  } catch {
    // Falls through to the error below.
  }

  throw new Error("APP_URL must be an http(s) URL, for example http://localhost:5173.");
}

function parseTrustProxy(value: string | undefined): boolean {
  const normalized = (value ?? "false").trim().toLowerCase();

  if (normalized === "true" || normalized === "false") {
    return normalized === "true";
  }

  throw new Error('TRUST_PROXY must be "true" or "false".');
}

function parseAuthJwtSecret(value: string | undefined): string {
  if (value === undefined || value.length < MIN_JWT_SECRET_LENGTH) {
    // The value is never echoed, not even a short one.
    throw new Error(
      `AUTH_JWT_SECRET must be set to a random secret of at least ${MIN_JWT_SECRET_LENGTH} ` +
        "characters. Add it to .env (see .env.example for how to generate one).",
    );
  }

  return value;
}

const DEFAULT_THREAD_POOL_SIZE = 4;
const DEFAULT_HASH_QUEUE_LIMIT = 64;

function parseInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer of at least ${min}.`);
  }

  return parsed;
}

/**
 * Hashes in flight stay below the libuv thread pool (`UV_THREADPOOL_SIZE`, default 4) so the JWT
 * check, `randomBytes` and the calls to the database always find a free thread.
 */
function parseHashConcurrency(env: Record<string, string | undefined>): number {
  const threadPool = parseInteger(
    "UV_THREADPOOL_SIZE",
    env.UV_THREADPOOL_SIZE,
    DEFAULT_THREAD_POOL_SIZE,
    1,
  );

  return parseInteger(
    "AUTH_HASH_CONCURRENCY",
    env.AUTH_HASH_CONCURRENCY,
    Math.max(1, threadPool - 1),
    1,
  );
}

export function validateEnvironment(env: Record<string, string | undefined>): Environment {
  const missing = REQUIRED_VARIABLES.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env at the repository root and fill in the values " +
        "(Supabase keys come from `bunx supabase status`).",
    );
  }

  const apiPort = Number(env.API_PORT ?? 3002);

  if (!Number.isInteger(apiPort) || apiPort <= 0 || apiPort > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  return {
    supabaseUrl: env.SUPABASE_URL as string,
    supabaseAnonKey: env.SUPABASE_ANON_KEY as string,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY as string,
    // Presence is checked above, so the value is a string here.
    appUrl: parseAppOrigin(env.APP_URL as string),
    apiPort,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318",
    otelServiceName: env.OTEL_SERVICE_NAME ?? "rondo-api",
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    email: parseEmailConfig(env),
    authJwtSecret: parseAuthJwtSecret(env.AUTH_JWT_SECRET),
    authHashConcurrency: parseHashConcurrency(env),
    authHashQueueLimit: parseInteger(
      "AUTH_HASH_QUEUE_LIMIT",
      env.AUTH_HASH_QUEUE_LIMIT,
      DEFAULT_HASH_QUEUE_LIMIT,
      0,
    ),
  };
}
