import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertMigrationsApplied,
  createAdminClient,
  deleteUsersByEmail,
  restRequest,
  signRoleToken,
  uniqueEmail,
} from "./support/supabase";

const SIGN_UP_PARAMS = (email: string, tokenHash: string) => ({
  p_first_name: "Ana",
  p_last_name: "Silva",
  p_email: email,
  p_password_hash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
  p_token_hash: tokenHash,
  p_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});

function uniqueTokenHash(): string {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

describe("users and auth_tokens in the database", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];

  function track(email: string): string {
    createdEmails.push(email);
    return email;
  }

  beforeAll(async () => {
    await assertMigrationsApplied(admin);
  });

  afterAll(async () => {
    await deleteUsersByEmail(admin, createdEmails);
  });

  describe.each(["anon", "authenticated"] as const)("as the %s role", (role) => {
    const token = signRoleToken(role);

    it("reads nothing from users or auth_tokens", async () => {
      const email = track(uniqueEmail(`rls-read-${role}`));
      const created = await admin.rpc("auth_sign_up", SIGN_UP_PARAMS(email, uniqueTokenHash()));

      expect(created.error).toBeNull();

      for (const table of ["users", "auth_tokens"]) {
        const response = await restRequest(`${table}?select=*`, token);
        const body: unknown = await response.json().catch(() => null);
        const rows = Array.isArray(body) ? body : [];

        expect(rows).toEqual([]);
        expect(JSON.stringify(body)).not.toContain(email);
      }
    });

    it("cannot write to users or auth_tokens", async () => {
      const email = track(uniqueEmail(`rls-write-${role}`));
      const insert = await restRequest("users", token, {
        method: "POST",
        body: JSON.stringify({
          first_name: "Eve",
          last_name: "Intruder",
          email,
          password_hash: "x",
        }),
      });

      expect(insert.status).toBeGreaterThanOrEqual(400);

      const { data } = await admin.from("users").select("id").eq("email", email);

      expect(data).toEqual([]);

      const update = await restRequest("users?email=like.*", token, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ first_name: "Hacked" }),
      });
      const updated: unknown = await update.json().catch(() => null);

      expect(Array.isArray(updated) ? updated : []).toEqual([]);

      const remove = await restRequest("auth_tokens?id=not.is.null", token, {
        method: "DELETE",
        headers: { prefer: "return=representation" },
      });
      const removed: unknown = await remove.json().catch(() => null);

      expect(Array.isArray(removed) ? removed : []).toEqual([]);
    });

    it("cannot call the auth_sign_up function", async () => {
      const email = track(uniqueEmail(`rpc-${role}`));
      const response = await restRequest("rpc/auth_sign_up", token, {
        method: "POST",
        body: JSON.stringify(SIGN_UP_PARAMS(email, uniqueTokenHash())),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);

      const { data } = await admin.from("users").select("id").eq("email", email);

      expect(data).toEqual([]);
    });
  });

  describe("auth_sign_up as the service role", () => {
    it("creates an unconfirmed user and its e-mail confirmation token together", async () => {
      const email = track(uniqueEmail("created"));
      const tokenHash = uniqueTokenHash();
      const { data: userId, error } = await admin.rpc(
        "auth_sign_up",
        SIGN_UP_PARAMS(email, tokenHash),
      );

      expect(error).toBeNull();
      expect(userId).toEqual(expect.any(String));

      const { data: user } = await admin
        .from("users")
        .select("first_name, last_name, email, password_hash, email_confirmed_at")
        .eq("id", userId)
        .single();

      expect(user).toMatchObject({
        first_name: "Ana",
        last_name: "Silva",
        email,
        email_confirmed_at: null,
      });

      const { data: tokens } = await admin
        .from("auth_tokens")
        .select("type, token_hash, used_at, expires_at")
        .eq("user_id", userId);

      expect(tokens).toHaveLength(1);
      expect(tokens?.[0]).toMatchObject({
        type: "email_confirmation",
        token_hash: tokenHash,
        used_at: null,
      });
    });

    it("returns null and writes nothing when the e-mail is already registered", async () => {
      const email = track(uniqueEmail("duplicate"));
      const first = await admin.rpc("auth_sign_up", SIGN_UP_PARAMS(email, uniqueTokenHash()));
      const secondHash = uniqueTokenHash();
      const second = await admin.rpc("auth_sign_up", SIGN_UP_PARAMS(email, secondHash));

      expect(first.data).toEqual(expect.any(String));
      expect(second.error).toBeNull();
      expect(second.data).toBeNull();

      const { data: tokens } = await admin
        .from("auth_tokens")
        .select("id")
        .eq("token_hash", secondHash);

      expect(tokens).toEqual([]);
    });

    it("lets exactly one of several simultaneous sign-ups with the same e-mail win", async () => {
      const email = track(uniqueEmail("race"));
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          admin.rpc("auth_sign_up", SIGN_UP_PARAMS(email, uniqueTokenHash())),
        ),
      );

      expect(results.every((result) => result.error === null)).toBe(true);
      expect(results.filter((result) => result.data !== null)).toHaveLength(1);

      const { data: users } = await admin.from("users").select("id").eq("email", email);

      expect(users).toHaveLength(1);
    });
  });

  describe("constraints", () => {
    it("rejects an e-mail that is not normalized", async () => {
      const { error } = await admin.from("users").insert({
        first_name: "Ana",
        last_name: "Silva",
        email: `Mixed.${uniqueEmail("case")}`.toUpperCase(),
        password_hash: "x",
      });

      expect(error?.code).toBe("23514");
    });

    it("keeps token_hash unique", async () => {
      const first = track(uniqueEmail("token-a"));
      const second = track(uniqueEmail("token-b"));
      const tokenHash = uniqueTokenHash();

      await admin.rpc("auth_sign_up", SIGN_UP_PARAMS(first, tokenHash));

      const { error } = await admin.rpc("auth_sign_up", SIGN_UP_PARAMS(second, tokenHash));

      expect(error?.code).toBe("23505");
    });

    it("deletes the tokens of a deleted user and refreshes updated_at on update", async () => {
      const email = track(uniqueEmail("cascade"));
      const tokenHash = uniqueTokenHash();
      const { data: userId } = await admin.rpc("auth_sign_up", SIGN_UP_PARAMS(email, tokenHash));
      const { data: before } = await admin
        .from("users")
        .select("updated_at")
        .eq("id", userId)
        .single();

      await new Promise((resolve) => setTimeout(resolve, 20));
      await admin.from("users").update({ first_name: "Bea" }).eq("id", userId);

      const { data: after } = await admin
        .from("users")
        .select("updated_at")
        .eq("id", userId)
        .single();

      expect(new Date(after?.updated_at).getTime()).toBeGreaterThan(
        new Date(before?.updated_at).getTime(),
      );

      await admin.from("users").delete().eq("id", userId);

      const { data: tokens } = await admin
        .from("auth_tokens")
        .select("id")
        .eq("token_hash", tokenHash);

      expect(tokens).toEqual([]);
    });
  });
});
