/** Prefix of every address the sign-up E2E tests create, so the clean-up can find them. */
export const E2E_EMAIL_PREFIX = "e2e-signup-";

/** Prefix of the users the session E2E tests seed (see `support/session.ts`). */
export const E2E_SESSION_EMAIL_PREFIX = "e2e-session-";

/**
 * Runs once after all workers: test data lives in the shared local database,
 * so remove it here (tokens and sessions go with the users by cascade). Doing it
 * per worker would delete rows that tests running in other workers still need.
 */
export default async function globalTeardown(): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  for (const prefix of [E2E_EMAIL_PREFIX, E2E_SESSION_EMAIL_PREFIX]) {
    const pattern = encodeURIComponent(`${prefix}*`);

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=like.${pattern}`, {
      method: "DELETE",
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
    });
  }
}
