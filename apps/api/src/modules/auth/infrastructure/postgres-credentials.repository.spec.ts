import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../../../observability/db-telemetry";
import { DataAccessError } from "./data-access-error";
import { PostgresCredentialsRepository } from "./postgres-credentials.repository";

function repositoryWith(response: { rows: unknown[] } | { error: unknown }) {
  const query = vi.fn();

  if ("error" in response) {
    query.mockRejectedValue(response.error);
  } else {
    query.mockResolvedValue({ rows: response.rows } as QueryResult<QueryResultRow>);
  }

  const database = { query, end: vi.fn() } as unknown as DatabaseClient;

  return { repository: new PostgresCredentialsRepository(database), query };
}

describe("PostgresCredentialsRepository.findByEmail", () => {
  it("reads the user by e-mail and maps the confirmed account", async () => {
    const { repository, query } = repositoryWith({
      rows: [
        { id: "u1", password_hash: "hash", email_confirmed_at: new Date("2026-11-09T12:00:00Z") },
      ],
    });

    await expect(repository.findByEmail("ana@example.test")).resolves.toEqual({
      userId: "u1",
      passwordHash: "hash",
      emailConfirmed: true,
    });
    expect(query).toHaveBeenCalledWith(
      { operation: "select", collection: "users" },
      "select id, password_hash, email_confirmed_at from public.users where email = $1",
      ["ana@example.test"],
    );
  });

  it("maps an unconfirmed account", async () => {
    const { repository } = repositoryWith({
      rows: [{ id: "u1", password_hash: "hash", email_confirmed_at: null }],
    });

    await expect(repository.findByEmail("ana@example.test")).resolves.toMatchObject({
      emailConfirmed: false,
    });
  });

  it("resolves null when there is no account", async () => {
    const { repository } = repositoryWith({ rows: [] });

    await expect(repository.findByEmail("nobody@example.test")).resolves.toBeNull();
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      error: Object.assign(new Error("failure for ana@example.test"), { code: "XX000" }),
    });

    const failure = await repository
      .findByEmail("ana@example.test")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "find_credentials", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it("rejects a row of the wrong shape", async () => {
    const { repository } = repositoryWith({ rows: [{ id: 7 }] });

    await expect(repository.findByEmail("ana@example.test")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});
