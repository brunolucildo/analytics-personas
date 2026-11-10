import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedConfirmedUser, sessionsOf } from "./support/sessions";
import {
  assertMigrationsApplied,
  createAdminClient,
  deleteUsersByEmail,
  restRequest,
  signRoleToken,
} from "./support/supabase";

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

describe("sessions in the database (R1)", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];

  async function newUser(label: string) {
    const user = await seedConfirmedUser(admin, label);

    createdEmails.push(user.email);
    return user;
  }

  beforeAll(async () => {
    await assertMigrationsApplied(admin);
  });

  afterAll(async () => {
    await deleteUsersByEmail(admin, createdEmails);
  });

  describe.each(["anon", "authenticated"] as const)("as the %s role", (role) => {
    const token = signRoleToken(role);

    it("reads and writes nothing in sessions", async () => {
      const user = await newUser(`sessions-rls-${role}`);
      const issued = await admin.rpc("auth_issue_session", {
        p_user_id: user.id,
        p_expires_at: inDays(7),
      });

      expect(issued.error).toBeNull();

      const read = await restRequest("sessions?select=*", token);
      const rows: unknown = await read.json().catch(() => null);

      expect(Array.isArray(rows) ? rows : []).toEqual([]);

      const insert = await restRequest("sessions", token, {
        method: "POST",
        body: JSON.stringify({ user_id: user.id, expires_at: inDays(7) }),
      });

      expect(insert.status).toBeGreaterThanOrEqual(400);

      const update = await restRequest("sessions?id=not.is.null", token, {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      });
      const updated: unknown = await update.json().catch(() => null);

      expect(Array.isArray(updated) ? updated : []).toEqual([]);
      expect(await sessionsOf(admin, user.id)).toHaveLength(1);
      expect((await sessionsOf(admin, user.id))[0]?.revoked_at).toBeNull();
    });

    it("cannot call auth_issue_session", async () => {
      const user = await newUser(`sessions-rpc-${role}`);
      const response = await restRequest("rpc/auth_issue_session", token, {
        method: "POST",
        body: JSON.stringify({ p_user_id: user.id, p_expires_at: inDays(7) }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await sessionsOf(admin, user.id)).toEqual([]);
    });
  });

  describe("the single active session rule", () => {
    it("rejects a second active session for the same user, straight in the table", async () => {
      const user = await newUser("sessions-unique");
      const first = await admin
        .from("sessions")
        .insert({ user_id: user.id, expires_at: inDays(7) });
      const second = await admin
        .from("sessions")
        .insert({ user_id: user.id, expires_at: inDays(7) });

      expect(first.error).toBeNull();
      expect(second.error?.code).toBe("23505");
    });

    it("allows many revoked sessions next to one active one", async () => {
      const user = await newUser("sessions-history");

      for (let index = 0; index < 3; index += 1) {
        const issued = await admin.rpc("auth_issue_session", {
          p_user_id: user.id,
          p_expires_at: inDays(7),
        });

        expect(issued.error).toBeNull();
      }

      const sessions = await sessionsOf(admin, user.id);

      expect(sessions).toHaveLength(3);
      expect(sessions.filter((session) => session.revoked_at === null)).toHaveLength(1);
    });
  });

  describe("auth_issue_session as the service role", () => {
    it("returns the new session id with the user's public fields and revokes the previous one", async () => {
      const user = await newUser("sessions-issue");
      const first = await admin.rpc("auth_issue_session", {
        p_user_id: user.id,
        p_expires_at: inDays(7),
      });
      const second = await admin.rpc("auth_issue_session", {
        p_user_id: user.id,
        p_expires_at: inDays(7),
      });

      expect(first.error).toBeNull();
      expect(second.error).toBeNull();
      expect(second.data).toEqual([
        {
          session_id: expect.any(String),
          first_name: user.firstName,
          last_name: user.lastName,
          email: user.email,
        },
      ]);

      const sessions = await sessionsOf(admin, user.id);
      const active = sessions.filter((session) => session.revoked_at === null);

      expect(active.map((session) => session.id)).toEqual([second.data?.[0]?.session_id]);
      expect(sessions.find((session) => session.id === first.data?.[0]?.session_id)).toMatchObject({
        revoked_at: expect.any(String),
      });
    });

    it("returns no row for an unknown user and creates nothing", async () => {
      const { data, error } = await admin.rpc("auth_issue_session", {
        p_user_id: crypto.randomUUID(),
        p_expires_at: inDays(7),
      });

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("leaves exactly one active session when many calls run at once", async () => {
      const user = await newUser("sessions-race");
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          admin.rpc("auth_issue_session", { p_user_id: user.id, p_expires_at: inDays(7) }),
        ),
      );

      expect(results.every((result) => result.error === null)).toBe(true);

      const sessions = await sessionsOf(admin, user.id);

      expect(sessions).toHaveLength(8);
      expect(sessions.filter((session) => session.revoked_at === null)).toHaveLength(1);
    });

    it("removes the user's sessions together with the user", async () => {
      const user = await newUser("sessions-cascade");

      await admin.rpc("auth_issue_session", { p_user_id: user.id, p_expires_at: inDays(7) });
      await deleteUsersByEmail(admin, [user.email]);

      expect(await sessionsOf(admin, user.id)).toEqual([]);
    });
  });
});
