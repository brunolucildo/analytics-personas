import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { DataAccessError } from "./data-access-error";
import { SupabasePasswordResetRepository } from "./supabase-password-reset.repository";

function repositoryWith(response: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(response);
  const repository = new SupabasePasswordResetRepository({ rpc } as unknown as SupabaseClient);

  return { repository, rpc };
}

describe("SupabasePasswordResetRepository.resetByTokenHash", () => {
  it("calls auth_reset_password with the token hash and the password hash and maps the row", async () => {
    const { repository, rpc } = repositoryWith({
      data: [{ user_id: "user-1", first_name: "Ana", email: "ana@example.test" }],
      error: null,
    });

    await expect(repository.resetByTokenHash("abc123", "$argon2id$hash")).resolves.toEqual({
      userId: "user-1",
      firstName: "Ana",
      email: "ana@example.test",
    });
    expect(rpc).toHaveBeenCalledWith("auth_reset_password", {
      p_token_hash: "abc123",
      p_password_hash: "$argon2id$hash",
    });
  });

  it("maps an empty result to null", async () => {
    const { repository } = repositoryWith({ data: [], error: null });

    await expect(repository.resetByTokenHash("abc123", "hash")).resolves.toBeNull();
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { code: "XX000", message: "failure for ana@example.test" },
    });

    const failure = await repository
      .resetByTokenHash("abc123", "hash")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_reset_password", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it.each([
    ["not a list", { oops: true }],
    ["a row of the wrong shape", [{ user_id: 1 }]],
  ])("rejects %s", async (_label, data) => {
    const { repository } = repositoryWith({ data, error: null });

    await expect(repository.resetByTokenHash("abc123", "hash")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});
