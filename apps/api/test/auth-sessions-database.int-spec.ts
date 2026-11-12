import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedConfirmedUser, sessionsOf } from "./support/sessions";
import {
  assertMigrationsApplied,
  deleteUsersByEmail,
  insertSession,
  issueSession,
} from "./support/database";

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe("sessions in the database (R1)", () => {
  const createdEmails: string[] = [];

  async function newUser(label: string) {
    const user = await seedConfirmedUser(label);

    createdEmails.push(user.email);
    return user;
  }

  beforeAll(async () => {
    await assertMigrationsApplied();
  });

  afterAll(async () => {
    await deleteUsersByEmail(createdEmails);
  });

  describe("the single active session rule", () => {
    it("rejects a second active session for the same user, straight in the table", async () => {
      const user = await newUser("sessions-unique");

      await insertSession(user.id, inDays(7));

      await expect(insertSession(user.id, inDays(7))).rejects.toMatchObject({ code: "23505" });
    });

    it("allows many revoked sessions next to one active one", async () => {
      const user = await newUser("sessions-history");

      for (let index = 0; index < 3; index += 1) {
        await issueSession(user.id, inDays(7));
      }

      const sessions = await sessionsOf(user.id);

      expect(sessions).toHaveLength(3);
      expect(sessions.filter((session) => session.revoked_at === null)).toHaveLength(1);
    });
  });

  describe("auth_issue_session", () => {
    it("returns the new session id with the user's public fields and revokes the previous one", async () => {
      const user = await newUser("sessions-issue");
      const first = await issueSession(user.id, inDays(7));
      const second = await issueSession(user.id, inDays(7));

      expect(second).toEqual([
        {
          session_id: expect.any(String),
          first_name: user.firstName,
          last_name: user.lastName,
          email: user.email,
        },
      ]);

      const sessions = await sessionsOf(user.id);
      const active = sessions.filter((session) => session.revoked_at === null);

      expect(active.map((session) => session.id)).toEqual([second[0]?.session_id]);
      expect(sessions.find((session) => session.id === first[0]?.session_id)).toMatchObject({
        revoked_at: expect.any(Date),
      });
    });

    it("returns no row for an unknown user and creates nothing", async () => {
      const issued = await issueSession(crypto.randomUUID(), inDays(7));

      expect(issued).toEqual([]);
    });

    it("leaves exactly one active session when many calls run at once", async () => {
      const user = await newUser("sessions-race");
      const results = await Promise.all(
        Array.from({ length: 8 }, () => issueSession(user.id, inDays(7))),
      );

      expect(results.every((result) => result.length === 1)).toBe(true);

      const sessions = await sessionsOf(user.id);

      expect(sessions).toHaveLength(8);
      expect(sessions.filter((session) => session.revoked_at === null)).toHaveLength(1);
    });

    it("removes the user's sessions together with the user", async () => {
      const user = await newUser("sessions-cascade");

      await issueSession(user.id, inDays(7));
      await deleteUsersByEmail([user.email]);

      expect(await sessionsOf(user.id)).toEqual([]);
    });
  });
});
