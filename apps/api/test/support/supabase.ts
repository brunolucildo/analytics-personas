import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set. Run integration tests with \`bun run test:integration\`.`);
  }

  return value;
}

export function supabaseUrl(): string {
  return requiredEnv("SUPABASE_URL");
}

/** Server-side client (service role): what the API itself uses. */
export function createAdminClient(): SupabaseClient {
  return createClient(supabaseUrl(), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** Signs a short-lived JWT for a Supabase role, to call PostgREST as that role. */
export function signRoleToken(role: "anon" | "authenticated"): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      role,
      aud: "authenticated",
      sub: randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
  );
  const signature = createHmac("sha256", requiredEnv("SUPABASE_JWT_SECRET"))
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

/** Calls the Supabase REST API (PostgREST) with the given bearer token. */
export function restRequest(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: requiredEnv("SUPABASE_ANON_KEY"),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

/** Fails with an actionable message when the sign-up migration is not applied. */
export async function assertMigrationsApplied(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.from("users").select("id").limit(1);

  if (error) {
    throw new Error(
      "The `users` table is not available in the local database. " +
        "Run `bun run infra:up` and `bun run db:migrate` from the repository root.",
    );
  }
}

/** Removes the users created by a test (tokens go with them: `on delete cascade`). */
export async function deleteUsersByEmail(admin: SupabaseClient, emails: string[]): Promise<void> {
  if (emails.length > 0) {
    await admin.from("users").delete().in("email", emails);
  }
}

export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID()}@example.test`;
}
