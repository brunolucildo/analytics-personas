import { createHash, randomBytes, randomUUID } from "node:crypto";
import { E2E_EMAIL_PREFIX } from "./global-teardown";

function serviceHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };
}

const rest = (path: string) => `${process.env.SUPABASE_URL}/rest/v1/${path}`;

export interface SeededUnconfirmedUser {
  id: string;
  email: string;
  /** The raw token of the confirmation link seeded with the account (the mailed one is unknown). */
  token: string;
}

/**
 * Inserts an UNCONFIRMED account and one valid confirmation token straight into the local database
 * (removed by the global teardown, which matches `E2E_EMAIL_PREFIX`). It stands in for a sign-up:
 * `POST /auth/sign-up` allows 5 per hour per IP and the other E2E specs already use that quota.
 */
export async function seedUnconfirmedUser(label: string): Promise<SeededUnconfirmedUser> {
  const email = `${E2E_EMAIL_PREFIX}${label}-${randomUUID()}@example.test`;
  const created = await fetch(rest("users"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      first_name: "Ana",
      last_name: "Silva",
      email,
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
    }),
  });
  const rows = (await created.json()) as Array<{ id: string }>;
  const id = rows[0]?.id;

  if (!created.ok || id === undefined) {
    throw new Error("Could not seed a user: is the local Supabase up with the migrations applied?");
  }

  const token = randomBytes(32).toString("base64url");
  const stored = await fetch(rest("auth_tokens"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      user_id: id,
      type: "email_confirmation",
      token_hash: createHash("sha256").update(token).digest("hex"),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  });

  if (!stored.ok) {
    throw new Error("Could not seed the confirmation token.");
  }

  return { id, email, token };
}
