import { createHmac, randomUUID } from "node:crypto";
import { E2E_SESSION_EMAIL_PREFIX } from "./global-teardown";

/** `localStorage` key the SPA keeps the access token under. */
export const ACCESS_TOKEN_KEY = "access_token";

export interface SeededUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}

const rest = (path: string) => `${process.env.SUPABASE_URL}/rest/v1/${path}`;

/** Inserts a confirmed user straight into the local database (removed by the global teardown). */
export async function seedConfirmedUser(
  label: string,
  firstName = "Ana",
  lastName = "Silva",
): Promise<SeededUser> {
  const email = `${E2E_SESSION_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`;
  const response = await fetch(rest("users"), {
    method: "POST",
    headers: { ...serviceHeaders(), prefer: "return=representation" },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email,
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
      email_confirmed_at: new Date().toISOString(),
    }),
  });
  const rows = (await response.json()) as Array<{ id: string }>;
  const id = rows[0]?.id;

  if (!response.ok || id === undefined) {
    throw new Error("Could not seed a user: is the local Supabase up with the migrations applied?");
  }

  return { id, firstName, lastName, email };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Starts a session for the user the way the API does (the `auth_issue_session` function, which
 * revokes the previous one) and signs the matching HS256 token with the secret the API under
 * test runs with, so the test needs no sign-in call (and no password).
 */
export async function issueAccessToken(userId: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 7 * 24 * 60 * 60;
  const response = await fetch(rest("rpc/auth_issue_session"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_user_id: userId,
      p_expires_at: new Date(expiresAt * 1000).toISOString(),
    }),
  });
  const rows = (await response.json()) as Array<{ session_id: string }>;
  const sessionId = rows[0]?.session_id;

  if (!response.ok || sessionId === undefined) {
    throw new Error("Could not issue a session for the seeded user.");
  }

  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ sub: userId, sid: sessionId, iat: issuedAt, exp: expiresAt }),
  );
  const signature = createHmac("sha256", process.env.AUTH_JWT_SECRET as string)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

/** A confirmed user with a live session: what a signed-in person looks like to the SPA and API. */
export async function seedSignedInUser(label: string, firstName = "Ana", lastName = "Silva") {
  const user = await seedConfirmedUser(label, firstName, lastName);

  return { user, token: await issueAccessToken(user.id) };
}
