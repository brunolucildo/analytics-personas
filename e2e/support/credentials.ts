import { randomUUID } from "node:crypto";
import { E2E_SESSION_EMAIL_PREFIX } from "./global-teardown";

/** Password every user seeded by `seedUserWithPassword` has (a test-only value, never a real secret). */
export const SEEDED_PASSWORD = "e2e-test-password-123";

/** Argon2id hash of `SEEDED_PASSWORD`, so the real sign-in can verify it. */
const SEEDED_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$VCbNcGllC8qszkdsuVo58Q$xJ4H2aSBIN8ZBqhn+SU1C5XzFEOv5dtqnhpC2Awqyrg";

export interface SeededCredentials {
  id: string;
  firstName: string;
  email: string;
  password: string;
}

/**
 * Inserts an account with a real password hash straight into the local database (removed by the
 * global teardown). It stands in for sign-up + confirmation: `POST /auth/sign-up` allows 5 per
 * hour per IP and the other E2E specs already use most of that quota.
 */
export async function seedUserWithPassword(
  label: string,
  { confirmed = true, firstName = "Ana" }: { confirmed?: boolean; firstName?: string } = {},
): Promise<SeededCredentials> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  const email = `${E2E_SESSION_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: "Silva",
      email,
      password_hash: SEEDED_PASSWORD_HASH,
      email_confirmed_at: confirmed ? new Date().toISOString() : null,
    }),
  });
  const rows = (await response.json()) as Array<{ id: string }>;
  const id = rows[0]?.id;

  if (!response.ok || id === undefined) {
    throw new Error("Could not seed a user: is the local Supabase up with the migrations applied?");
  }

  return { id, firstName, email, password: SEEDED_PASSWORD };
}
