import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import { DataAccessError } from "./data-access-error";
import { PostgresConfirmationRepository } from "./postgres-confirmation.repository";

const TOKEN = { tokenHash: "abc123", expiresAt: new Date("2026-11-10T12:00:00.000Z") };

function repositoryWith(response: { rows: unknown[] } | { error: unknown }) {
  const query = vi.fn();

  if ("error" in response) {
    query.mockRejectedValue(response.error);
  } else {
    query.mockResolvedValue({ rows: response.rows } as QueryResult<QueryResultRow>);
  }

  const database = { query, end: vi.fn() } as unknown as DatabaseClient;

  return { repository: new PostgresConfirmationRepository(database), query };
}

describe("PostgresConfirmationRepository.confirmByTokenHash", () => {
  it("calls auth_confirm_account with the token hash and returns the user id", async () => {
    const { repository, query } = repositoryWith({ rows: [{ user_id: "user-1" }] });

    await expect(repository.confirmByTokenHash("abc123")).resolves.toBe("user-1");
    expect(query).toHaveBeenCalledWith(
      { operation: "rpc", procedure: "auth_confirm_account" },
      "select public.auth_confirm_account($1) as user_id",
      ["abc123"],
    );
  });

  it("resolves null when the function found no usable token", async () => {
    const { repository } = repositoryWith({ rows: [{ user_id: null }] });

    await expect(repository.confirmByTokenHash("abc123")).resolves.toBeNull();
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      error: Object.assign(new Error("failure for abc123"), { code: "XX000" }),
    });

    const failure = await repository.confirmByTokenHash("abc123").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_confirm_account", code: "XX000" });
    expect((failure as Error).message).not.toContain("abc123");
  });

  it("rejects a result that is neither null nor an id", async () => {
    const { repository } = repositoryWith({ rows: [{ user_id: { oops: true } }] });

    await expect(repository.confirmByTokenHash("abc123")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});

describe("PostgresConfirmationRepository.renewForUnconfirmedUser", () => {
  it("calls auth_resend_confirmation with the e-mail, the token hash and the ISO expiry", async () => {
    const { repository, query } = repositoryWith({ rows: [{ first_name: "Ana" }] });

    const result = await repository.renewForUnconfirmedUser("ana@example.test", TOKEN);

    expect(result).toEqual({ status: "created", firstName: "Ana" });
    expect(query).toHaveBeenCalledWith(
      { operation: "rpc", procedure: "auth_resend_confirmation" },
      "select public.auth_resend_confirmation($1, $2, $3) as first_name",
      ["ana@example.test", "abc123", "2026-11-10T12:00:00.000Z"],
    );
  });

  it("maps a null result to no_action", async () => {
    const { repository } = repositoryWith({ rows: [{ first_name: null }] });

    await expect(repository.renewForUnconfirmedUser("ana@example.test", TOKEN)).resolves.toEqual({
      status: "no_action",
    });
  });

  it("throws a DataAccessError without the e-mail", async () => {
    const { repository } = repositoryWith({
      error: Object.assign(new Error("failure for ana@example.test"), { code: "XX000" }),
    });

    const failure = await repository
      .renewForUnconfirmedUser("ana@example.test", TOKEN)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_resend_confirmation", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it("rejects a result that is neither null nor a name", async () => {
    const { repository } = repositoryWith({ rows: [{ first_name: 42 }] });

    await expect(
      repository.renewForUnconfirmedUser("ana@example.test", TOKEN),
    ).rejects.toMatchObject({ code: "UNEXPECTED_RESULT" });
  });
});
