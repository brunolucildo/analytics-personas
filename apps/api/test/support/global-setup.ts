import { Client } from "pg";
import { LOCAL_DATABASE_URL } from "./local-database-url";

/**
 * Integration tests run against the local Postgres. The database must be up and
 * migrated before the first worker starts; the failure message says how to fix it.
 *
 * `globalSetup` runs in the main process before `setup-env.ts`, so it applies the
 * same local default itself (the workers inherit this process.env).
 */
export default async function setup(): Promise<void> {
  process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Run `bun run infra:up` and `bun run db:migrate` " +
        "from the repository root, with .env copied from .env.example.",
    );
  }

  const client = new Client({ connectionString, application_name: "rondo-tests-setup" });

  try {
    await client.connect();
    await client.query("select 1 from public.users limit 1");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown";

    if (code === "42P01") {
      throw new Error(
        "The local database has no `users` table. Run `bun run db:migrate` from the repository root.",
      );
    }

    throw new Error(
      "Could not reach the local Postgres. Run `bun run infra:up` and `bun run db:migrate` " +
        `from the repository root (${code === "unknown" ? "connection failed" : `SQLSTATE ${code}`}).`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
