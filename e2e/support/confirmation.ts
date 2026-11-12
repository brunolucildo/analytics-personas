import { createHash, randomBytes, randomUUID } from "node:crypto";
import { insertConfirmationToken, insertUser } from "./database";
import { E2E_EMAIL_PREFIX } from "./global-teardown";

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
  const id = await insertUser({
    firstName: "Ana",
    lastName: "Silva",
    email,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
  });
  const token = randomBytes(32).toString("base64url");

  await insertConfirmationToken(
    id,
    createHash("sha256").update(token).digest("hex"),
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  );

  return { id, email, token };
}
