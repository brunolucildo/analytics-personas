import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPOSITORY_ROOT = resolve(__dirname, "../..");

/** `supabase status -o env` name -> variable the API and the tests read. */
const STATUS_TO_ENV = {
  API_URL: "SUPABASE_URL",
  ANON_KEY: "SUPABASE_ANON_KEY",
  SERVICE_ROLE_KEY: "SUPABASE_SERVICE_ROLE_KEY",
  JWT_SECRET: "SUPABASE_JWT_SECRET",
} as const;

function parseStatusOutput(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());

    if (match?.[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = match[2];
    }
  }

  return values;
}

/**
 * Makes the Supabase variables of the local stack available in `process.env`
 * for integration and E2E runs. Variables already set (a `.env` loaded by the
 * shell, CI) are kept; otherwise they are read from `supabase status -o env`.
 * Runs from Node (Vitest and Playwright), so it does not use Bun APIs.
 */
export function ensureLocalSupabaseEnv(): void {
  if (Object.values(STATUS_TO_ENV).every((name) => process.env[name])) {
    return;
  }

  const result = spawnSync("bun", ["x", "supabase", "status", "-o", "env"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  const values = parseStatusOutput(result.stdout ?? "");
  const missing = Object.keys(STATUS_TO_ENV).filter((name) => !values[name]);

  if (result.status !== 0 || missing.length > 0) {
    throw new Error(
      "This run needs the local Supabase stack, but `supabase status` did not return it. " +
        "Start Docker, then run `bun run infra:up` and `bun run db:migrate` from the repository root.",
    );
  }

  for (const [source, target] of Object.entries(STATUS_TO_ENV)) {
    process.env[target] = values[source] as string;
  }
}
