import { insertUser, listSessionsOfUser, uniqueEmail, type SessionRow } from "./database";

export interface SeededUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Inserts a confirmed user straight into the database, so session tests need no
 * sign-up or sign-in. The password hash is a placeholder: nothing in these tests
 * verifies a password. Remove it with `deleteUsersByEmail`.
 */
export async function seedConfirmedUser(
  label: string,
  names: { firstName: string; lastName: string } = { firstName: "Ana", lastName: "Silva" },
): Promise<SeededUser> {
  const email = uniqueEmail(label);
  const { id } = await insertUser({
    firstName: names.firstName,
    lastName: names.lastName,
    email,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
    emailConfirmedAt: new Date(),
  });

  return { id, ...names, email };
}

/** Sessions of a user, newest first, as stored (snake_case columns). */
export async function sessionsOf(userId: string): Promise<SessionRow[]> {
  return listSessionsOfUser(userId);
}
