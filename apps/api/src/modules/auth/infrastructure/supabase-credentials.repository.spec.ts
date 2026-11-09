import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { DataAccessError } from "./data-access-error";
import { SupabaseCredentialsRepository } from "./supabase-credentials.repository";

function repositoryWith(response: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue(response);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const repository = new SupabaseCredentialsRepository({ from } as unknown as SupabaseClient);

  return { repository, from, select, eq };
}

describe("SupabaseCredentialsRepository.findByEmail", () => {
  it("reads the user by e-mail and maps the confirmed account", async () => {
    const { repository, from, select, eq } = repositoryWith({
      data: { id: "u1", password_hash: "hash", email_confirmed_at: "2026-11-09T12:00:00Z" },
      error: null,
    });

    await expect(repository.findByEmail("ana@example.test")).resolves.toEqual({
      userId: "u1",
      passwordHash: "hash",
      emailConfirmed: true,
    });
    expect(from).toHaveBeenCalledWith("users");
    expect(select).toHaveBeenCalledWith("id, password_hash, email_confirmed_at");
    expect(eq).toHaveBeenCalledWith("email", "ana@example.test");
  });

  it("maps an unconfirmed account", async () => {
    const { repository } = repositoryWith({
      data: { id: "u1", password_hash: "hash", email_confirmed_at: null },
      error: null,
    });

    await expect(repository.findByEmail("ana@example.test")).resolves.toMatchObject({
      emailConfirmed: false,
    });
  });

  it("resolves null when there is no account", async () => {
    const { repository } = repositoryWith({ data: null, error: null });

    await expect(repository.findByEmail("nobody@example.test")).resolves.toBeNull();
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { code: "XX000", message: "failure for ana@example.test" },
    });

    const failure = await repository
      .findByEmail("ana@example.test")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "find_credentials", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it("rejects a row of the wrong shape", async () => {
    const { repository } = repositoryWith({ data: { id: 7 }, error: null });

    await expect(repository.findByEmail("ana@example.test")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});
