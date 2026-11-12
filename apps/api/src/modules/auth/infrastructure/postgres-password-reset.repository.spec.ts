import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import { DataAccessError } from "./data-access-error";
import { PostgresPasswordResetRepository } from "./postgres-password-reset.repository";

const TOKEN = { tokenHash: "abc123", expiresAt: new Date("2026-11-09T13:00:00.000Z") };

function repositoryWith(response: { rows: unknown[] } | { error: unknown }) {
  const query = vi.fn();

  if ("error" in response) {
    query.mockRejectedValue(response.error);
  } else {
    query.mockResolvedValue({ rows: response.rows } as QueryResult<QueryResultRow>);
  }

  const database = { query, end: vi.fn() } as unknown as DatabaseClient;

  return { repository: new PostgresPasswordResetRepository(database), query };
}

describe("PostgresPasswordResetRepository.createForConfirmedUser", () => {
  it("calls auth_request_password_reset with the e-mail, the token hash and the ISO expiry", async () => {
    const { repository, query } = repositoryWith({ rows: [{ first_name: "Ana" }] });

    const result = await repository.createForConfirmedUser("ana@example.test", TOKEN);

    expect(result).toEqual({ status: "created", firstName: "Ana" });
    expect(query).toHaveBeenCalledWith(
      { operation: "rpc", procedure: "auth_request_password_reset" },
      "select public.auth_request_password_reset($1, $2, $3) as first_name",
      ["ana@example.test", "abc123", "2026-11-09T13:00:00.000Z"],
    );
  });

  it("maps a null result to no_action", async () => {
    const { repository } = repositoryWith({ rows: [{ first_name: null }] });

    await expect(repository.createForConfirmedUser("ana@example.test", TOKEN)).resolves.toEqual({
      status: "no_action",
    });
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      error: Object.assign(new Error("failure for ana@example.test"), { code: "XX000" }),
    });

    const failure = await repository
      .createForConfirmedUser("ana@example.test", TOKEN)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_request_password_reset", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it("rejects a result that is neither null nor a name", async () => {
    const { repository } = repositoryWith({ rows: [{ first_name: { oops: true } }] });

    await expect(
      repository.createForConfirmedUser("ana@example.test", TOKEN),
    ).rejects.toMatchObject({ code: "UNEXPECTED_RESULT" });
  });
});

describe("PostgresPasswordResetRepository.resetByTokenHash", () => {
  it("calls auth_reset_password with the token hash and the password hash and maps the row", async () => {
    const { repository, query } = repositoryWith({
      rows: [{ user_id: "user-1", first_name: "Ana", email: "ana@example.test" }],
    });

    await expect(repository.resetByTokenHash("abc123", "$argon2id$hash")).resolves.toEqual({
      userId: "user-1",
      firstName: "Ana",
      email: "ana@example.test",
    });
    expect(query).toHaveBeenCalledWith(
      { operation: "rpc", procedure: "auth_reset_password" },
      "select user_id, first_name, email from public.auth_reset_password($1, $2)",
      ["abc123", "$argon2id$hash"],
    );
  });

  it("maps an empty result to null", async () => {
    const { repository } = repositoryWith({ rows: [] });

    await expect(repository.resetByTokenHash("abc123", "hash")).resolves.toBeNull();
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      error: Object.assign(new Error("failure for ana@example.test"), { code: "XX000" }),
    });

    const failure = await repository
      .resetByTokenHash("abc123", "hash")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_reset_password", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it.each([["a row of the wrong shape", [{ user_id: 1 }]]])("rejects %s", async (_label, rows) => {
    const { repository } = repositoryWith({ rows });

    await expect(repository.resetByTokenHash("abc123", "hash")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });

  it("rejects a result with more than one row", async () => {
    const { repository } = repositoryWith({
      rows: [
        { user_id: "user-1", first_name: "Ana", email: "ana@example.test" },
        { user_id: "user-2", first_name: "Bea", email: "bea@example.test" },
      ],
    });

    await expect(repository.resetByTokenHash("abc123", "hash")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});
