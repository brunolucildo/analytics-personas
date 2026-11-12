import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import { DataAccessError } from "./data-access-error";
import { PostgresSessionRepository } from "./postgres-session.repository";

const USER_ID = "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b";
const SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const EXPIRES_AT = new Date("2026-11-16T12:00:00.000Z");

function repositoryWith(response: { rows: unknown[] } | { error: unknown }) {
  const query = vi.fn();

  if ("error" in response) {
    query.mockRejectedValue(response.error);
  } else {
    query.mockResolvedValue({ rows: response.rows } as QueryResult<QueryResultRow>);
  }

  const database = { query, end: vi.fn() } as unknown as DatabaseClient;

  return { repository: new PostgresSessionRepository(database), query };
}

describe("PostgresSessionRepository", () => {
  describe("issue", () => {
    it("calls auth_issue_session with the user and the ISO expiry and maps the row", async () => {
      const { repository, query } = repositoryWith({
        rows: [
          { session_id: SESSION_ID, first_name: "Ana", last_name: "Silva", email: "a@x.test" },
        ],
      });

      await expect(repository.issue(USER_ID, EXPIRES_AT)).resolves.toEqual({
        sessionId: SESSION_ID,
        user: { id: USER_ID, firstName: "Ana", lastName: "Silva", email: "a@x.test" },
      });
      expect(query).toHaveBeenCalledWith(
        { operation: "rpc", procedure: "auth_issue_session" },
        "select session_id, first_name, last_name, email from public.auth_issue_session($1, $2)",
        [USER_ID, "2026-11-16T12:00:00.000Z"],
      );
    });

    it("resolves null when the function returns no row (unknown user)", async () => {
      const { repository } = repositoryWith({ rows: [] });

      await expect(repository.issue(USER_ID, EXPIRES_AT)).resolves.toBeNull();
    });

    it("throws a DataAccessError that keeps the code but not the database message", async () => {
      const { repository } = repositoryWith({
        error: Object.assign(new Error(`Key (user_id)=(${USER_ID.slice(0, 8)}) is not present`), {
          code: "23503",
        }),
      });
      const failure = await repository.issue(USER_ID, EXPIRES_AT).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(DataAccessError);
      expect(failure).toMatchObject({ operation: "auth_issue_session", code: "23503" });
      expect(String((failure as Error).message)).not.toContain(USER_ID.slice(0, 8));
    });

    it("rejects a row of an unexpected shape", async () => {
      const { repository } = repositoryWith({ rows: [{ session_id: 1 }] });

      await expect(repository.issue(USER_ID, EXPIRES_AT)).rejects.toMatchObject({
        code: "UNEXPECTED_RESULT",
      });
    });
  });

  describe("findById", () => {
    const row = {
      id: SESSION_ID,
      expires_at: new Date("2026-11-16T12:00:00.000Z"),
      revoked_at: null,
      user_id: USER_ID,
      first_name: "Ana",
      last_name: "Silva",
      email: "a@x.test",
    };

    it("reads one session with its user", async () => {
      const { repository, query } = repositoryWith({ rows: [row] });

      await expect(repository.findById(SESSION_ID)).resolves.toEqual({
        id: SESSION_ID,
        expiresAt: new Date("2026-11-16T12:00:00.000Z"),
        revokedAt: null,
        user: { id: USER_ID, firstName: "Ana", lastName: "Silva", email: "a@x.test" },
      });
      expect(query).toHaveBeenCalledWith(
        { operation: "select", collection: "sessions" },
        expect.stringContaining("from public.sessions s"),
        [SESSION_ID],
      );
    });

    it("reads revoked_at as a date", async () => {
      const { repository } = repositoryWith({
        rows: [{ ...row, revoked_at: new Date("2026-11-10T00:00:00.000Z") }],
      });

      await expect(repository.findById(SESSION_ID)).resolves.toMatchObject({
        revokedAt: new Date("2026-11-10T00:00:00.000Z"),
      });
    });

    it("resolves null when there is no such session", async () => {
      const { repository } = repositoryWith({ rows: [] });

      await expect(repository.findById(SESSION_ID)).resolves.toBeNull();
    });

    it("throws a DataAccessError when the database fails", async () => {
      const { repository } = repositoryWith({
        error: Object.assign(new Error("terminating connection"), { code: "57P01" }),
      });

      await expect(repository.findById(SESSION_ID)).rejects.toMatchObject({
        operation: "find_session",
        code: "57P01",
      });
    });
  });

  describe("revoke", () => {
    it("revokes only an active session", async () => {
      const { repository, query } = repositoryWith({ rows: [] });

      await repository.revoke(SESSION_ID);

      expect(query).toHaveBeenCalledWith(
        { operation: "update", collection: "sessions" },
        "update public.sessions set revoked_at = now() where id = $1 and revoked_at is null",
        [SESSION_ID],
      );
    });

    it("throws a DataAccessError when the database fails", async () => {
      const { repository } = repositoryWith({
        error: Object.assign(new Error("x"), { code: "XX000" }),
      });

      await expect(repository.revoke(SESSION_ID)).rejects.toMatchObject({
        operation: "revoke_session",
      });
    });
  });
});
