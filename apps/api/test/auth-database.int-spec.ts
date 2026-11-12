import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertMigrationsApplied,
  deleteUsersByEmail,
  deleteUserById,
  findUserByEmail,
  findUserById,
  insertUser,
  listTokensByHash,
  listTokensOfUser,
  listUsersByEmail,
  query,
  randomTokenHash,
  rows,
  sha256,
  signUp,
  uniqueEmail,
  updateUserFirstName,
} from "./support/database";

const PLACEHOLDER_HASH = "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder";

const signUpParams = (email: string, tokenHash: string) => ({
  firstName: "Ana",
  lastName: "Silva",
  email,
  passwordHash: PLACEHOLDER_HASH,
  tokenHash,
  tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
});

describe("users and auth_tokens in the database", () => {
  const createdEmails: string[] = [];

  function track(email: string): string {
    createdEmails.push(email);
    return email;
  }

  beforeAll(async () => {
    await assertMigrationsApplied();
  });

  afterAll(async () => {
    await deleteUsersByEmail(createdEmails);
  });

  describe("R2: roles and privileges", () => {
    it("has no platform roles from the old setup", async () => {
      const found = await rows<{ rolname: string }>(
        "select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')",
      );

      expect(found).toEqual([]);
    });

    it("owns the schema as rondo_migrator", async () => {
      const found = await rows<{ tableowner: string }>(
        "select tableowner from pg_tables where schemaname = 'public' and tablename = 'users'",
      );

      expect(found[0]?.tableowner).toBe("rondo_migrator");
    });

    it("refuses DDL as rondo_app with 42501", async () => {
      await expect(query("create table public.ddl_probe (id integer)")).rejects.toMatchObject({
        code: "42501",
      });
      await expect(query("drop table public.users")).rejects.toMatchObject({ code: "42501" });
    });

    it("grants DML on every auth table and execute on every auth function to rondo_app", async () => {
      const tables = await rows<{ allowed: boolean }>(
        `select bool_and(has_table_privilege('rondo_app', format('public.%I', tablename), 'select,insert,update,delete')) as allowed
           from pg_tables
          where schemaname = 'public' and tablename in ('users', 'auth_tokens', 'sessions')`,
      );
      const functions = await rows<{ allowed: boolean }>(
        `select bool_and(has_function_privilege('rondo_app', oid, 'execute')) as allowed
           from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'auth_sign_up', 'auth_issue_session', 'auth_confirm_account',
              'auth_resend_confirmation', 'auth_request_password_reset', 'auth_reset_password'
            )`,
      );

      expect(tables[0]?.allowed).toBe(true);
      expect(functions[0]?.allowed).toBe(true);
    });
  });

  describe("auth_sign_up as the API user", () => {
    it("creates an unconfirmed user and its e-mail confirmation token together", async () => {
      const email = track(uniqueEmail("created"));
      const tokenHash = randomTokenHash();
      const userId = await signUp(signUpParams(email, tokenHash));

      expect(userId).toEqual(expect.any(String));

      const user = await findUserById(userId as string);

      expect(user).toMatchObject({
        first_name: "Ana",
        last_name: "Silva",
        email,
        email_confirmed_at: null,
      });

      const tokens = await listTokensOfUser(userId as string);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: "email_confirmation",
        token_hash: tokenHash,
        used_at: null,
      });
    });

    it("returns null and writes nothing when the e-mail is already registered", async () => {
      const email = track(uniqueEmail("duplicate"));
      const first = await signUp(signUpParams(email, randomTokenHash()));
      const secondHash = randomTokenHash();
      const second = await signUp(signUpParams(email, secondHash));

      expect(first).toEqual(expect.any(String));
      expect(second).toBeNull();
      expect(await listTokensByHash(secondHash)).toEqual([]);
    });

    it("lets exactly one of several simultaneous sign-ups with the same e-mail win", async () => {
      const email = track(uniqueEmail("race"));
      const results = await Promise.all(
        Array.from({ length: 8 }, () => signUp(signUpParams(email, randomTokenHash()))),
      );

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(await listUsersByEmail(email)).toHaveLength(1);
    });
  });

  describe("constraints", () => {
    it("rejects an e-mail that is not normalized", async () => {
      await expect(
        insertUser({
          firstName: "Ana",
          lastName: "Silva",
          email: `Mixed.${uniqueEmail("case")}`.toUpperCase(),
          passwordHash: "x",
        }),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("keeps token_hash unique", async () => {
      const first = track(uniqueEmail("token-a"));
      const second = track(uniqueEmail("token-b"));
      const tokenHash = randomTokenHash();

      await signUp(signUpParams(first, tokenHash));

      await expect(signUp(signUpParams(second, tokenHash))).rejects.toMatchObject({
        code: "23505",
      });
    });

    it("deletes the tokens of a deleted user and refreshes updated_at on update", async () => {
      const email = track(uniqueEmail("cascade"));
      const tokenHash = randomTokenHash();
      const userId = (await signUp(signUpParams(email, tokenHash))) as string;
      const before = await findUserById(userId);

      await new Promise((resolve) => setTimeout(resolve, 20));
      await updateUserFirstName(userId, "Bea");

      const after = await findUserById(userId);

      expect(after?.updated_at.getTime()).toBeGreaterThan(before?.updated_at.getTime() ?? 0);

      await deleteUserById(userId);

      expect(await listTokensByHash(tokenHash)).toEqual([]);
      expect(await findUserByEmail(email)).toBeNull();
    });

    it("stores only the hash of a token, never the raw value", async () => {
      const email = track(uniqueEmail("hash-only"));
      const rawToken = `raw-${uniqueEmail("sentinel")}`;
      const tokenHash = sha256(rawToken);

      await signUp(signUpParams(email, tokenHash));

      const stored = await listTokensByHash(tokenHash);

      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(rawToken);
    });
  });
});
