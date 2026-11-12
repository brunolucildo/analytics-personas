import { randomUUID } from "node:crypto";
import { insertUser } from "./database";
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
  const email = `${E2E_SESSION_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`;
  const id = await insertUser({
    firstName,
    lastName: "Silva",
    email,
    passwordHash: SEEDED_PASSWORD_HASH,
    emailConfirmedAt: confirmed ? new Date() : null,
  });

  return { id, firstName, email, password: SEEDED_PASSWORD };
}
