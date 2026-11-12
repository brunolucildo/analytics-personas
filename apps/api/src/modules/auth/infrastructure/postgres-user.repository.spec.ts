import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import { DataAccessError } from "./data-access-error";
import { PostgresUserRepository } from "./postgres-user.repository";

const USER = {
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
  passwordHash: "$argon2id$hash",
};
const TOKEN = { tokenHash: "abc123", expiresAt: new Date("2026-11-10T12:00:00.000Z") };

function repositoryWith(response: { rows: unknown[] } | { error: unknown }) {
  const query = vi.fn();

  if ("error" in response) {
    query.mockRejectedValue(response.error);
  } else {
    query.mockResolvedValue({ rows: response.rows } as QueryResult<QueryResultRow>);
  }

  const database = { query, end: vi.fn() } as unknown as DatabaseClient;

  return { repository: new PostgresUserRepository(database), query };
}

describe("PostgresUserRepository", () => {
  it("calls auth_sign_up with the user, the token hash and the ISO expiry", async () => {
    const { repository, query } = repositoryWith({ rows: [{ user_id: "user-id" }] });

    const result = await repository.createWithConfirmationToken(USER, TOKEN);

    expect(result).toEqual({ status: "created", userId: "user-id" });
    expect(query).toHaveBeenCalledWith(
      { operation: "rpc", procedure: "auth_sign_up" },
      "select public.auth_sign_up($1, $2, $3, $4, $5, $6) as user_id",
      [
        "Ana",
        "Silva",
        "ana@example.test",
        "$argon2id$hash",
        "abc123",
        "2026-11-10T12:00:00.000Z",
      ],
    );
  });

  it("maps a null result to email_taken", async () => {
    const { repository } = repositoryWith({ rows: [{ user_id: null }] });

    await expect(repository.createWithConfirmationToken(USER, TOKEN)).resolves.toEqual({
      status: "email_taken",
    });
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      error: Object.assign(new Error("duplicate key value (email)=(ana@example.test)"), {
        code: "XX000",
      }),
    });

    const failure = await repository
      .createWithConfirmationToken(USER, TOKEN)
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_sign_up", code: "XX000" });
    expect(String((failure as Error).message)).not.toContain("ana@example.test");
  });

  it("rejects a result that is not an id", async () => {
    const { repository } = repositoryWith({ rows: [{ user_id: 1 }] });

    await expect(repository.createWithConfirmationToken(USER, TOKEN)).rejects.toBeInstanceOf(
      DataAccessError,
    );
  });

  it("rejects a result with more than one row", async () => {
    const { repository } = repositoryWith({ rows: [{ user_id: "a" }, { user_id: "b" }] });

    await expect(repository.createWithConfirmationToken(USER, TOKEN)).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});
