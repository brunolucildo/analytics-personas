import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { DataAccessError } from "./data-access-error";
import { SupabaseSessionRepository } from "./supabase-session.repository";

const USER_ID = "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b";
const SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const EXPIRES_AT = new Date("2026-11-16T12:00:00.000Z");

type Response = { data: unknown; error: { code?: string; message: string } | null };

function rpcRepository(response: Response) {
  const rpc = vi.fn().mockResolvedValue(response);

  return { repository: new SupabaseSessionRepository({ rpc } as unknown as SupabaseClient), rpc };
}

/** A minimal chainable stand-in for `from("sessions")...`. */
function queryRepository(response: Response) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue(response),
    maybeSingle: vi.fn().mockResolvedValue(response),
  };
  const from = vi.fn().mockReturnValue(chain);

  return {
    repository: new SupabaseSessionRepository({ from } as unknown as SupabaseClient),
    from,
    chain,
  };
}

describe("SupabaseSessionRepository", () => {
  describe("issue", () => {
    it("calls auth_issue_session with the user and the ISO expiry and maps the row", async () => {
      const { repository, rpc } = rpcRepository({
        data: [
          { session_id: SESSION_ID, first_name: "Ana", last_name: "Silva", email: "a@x.test" },
        ],
        error: null,
      });

      await expect(repository.issue(USER_ID, EXPIRES_AT)).resolves.toEqual({
        sessionId: SESSION_ID,
        user: { id: USER_ID, firstName: "Ana", lastName: "Silva", email: "a@x.test" },
      });
      expect(rpc).toHaveBeenCalledWith("auth_issue_session", {
        p_user_id: USER_ID,
        p_expires_at: "2026-11-16T12:00:00.000Z",
      });
    });

    it("resolves null when the function returns no row (unknown user)", async () => {
      const { repository } = rpcRepository({ data: [], error: null });

      await expect(repository.issue(USER_ID, EXPIRES_AT)).resolves.toBeNull();
    });

    it("throws a DataAccessError that keeps the code but not the database message", async () => {
      const { repository } = rpcRepository({
        data: null,
        error: { code: "23503", message: "Key (user_id)=(5f1b6c1e) is not present" },
      });
      const failure = await repository.issue(USER_ID, EXPIRES_AT).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(DataAccessError);
      expect(failure).toMatchObject({ operation: "auth_issue_session", code: "23503" });
      expect(String((failure as Error).message)).not.toContain(USER_ID.slice(0, 8));
    });

    it("rejects a row of an unexpected shape", async () => {
      const { repository } = rpcRepository({ data: [{ session_id: 1 }], error: null });

      await expect(repository.issue(USER_ID, EXPIRES_AT)).rejects.toMatchObject({
        code: "UNEXPECTED_RESULT",
      });
    });
  });

  describe("findById", () => {
    const row = {
      id: SESSION_ID,
      expires_at: "2026-11-16T12:00:00+00:00",
      revoked_at: null,
      users: { id: USER_ID, first_name: "Ana", last_name: "Silva", email: "a@x.test" },
    };

    it("reads one session with its user", async () => {
      const { repository, from, chain } = queryRepository({ data: row, error: null });

      await expect(repository.findById(SESSION_ID)).resolves.toEqual({
        id: SESSION_ID,
        expiresAt: new Date("2026-11-16T12:00:00.000Z"),
        revokedAt: null,
        user: { id: USER_ID, firstName: "Ana", lastName: "Silva", email: "a@x.test" },
      });
      expect(from).toHaveBeenCalledWith("sessions");
      expect(chain.eq).toHaveBeenCalledWith("id", SESSION_ID);
    });

    it("reads revoked_at as a date", async () => {
      const { repository } = queryRepository({
        data: { ...row, revoked_at: "2026-11-10T00:00:00+00:00" },
        error: null,
      });

      await expect(repository.findById(SESSION_ID)).resolves.toMatchObject({
        revokedAt: new Date("2026-11-10T00:00:00.000Z"),
      });
    });

    it("resolves null when there is no such session", async () => {
      const { repository } = queryRepository({ data: null, error: null });

      await expect(repository.findById(SESSION_ID)).resolves.toBeNull();
    });

    it("throws a DataAccessError when the database fails", async () => {
      const { repository } = queryRepository({
        data: null,
        error: { code: "57P01", message: "terminating connection" },
      });

      await expect(repository.findById(SESSION_ID)).rejects.toMatchObject({
        operation: "find_session",
        code: "57P01",
      });
    });
  });

  describe("revoke", () => {
    it("revokes only an active session", async () => {
      const { repository, chain } = queryRepository({ data: null, error: null });

      await repository.revoke(SESSION_ID);

      expect(chain.update).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
      expect(chain.eq).toHaveBeenCalledWith("id", SESSION_ID);
      expect(chain.is).toHaveBeenCalledWith("revoked_at", null);
    });

    it("throws a DataAccessError when the database fails", async () => {
      const { repository } = queryRepository({
        data: null,
        error: { code: "XX000", message: "x" },
      });

      await expect(repository.revoke(SESSION_ID)).rejects.toMatchObject({
        operation: "revoke_session",
      });
    });
  });
});
