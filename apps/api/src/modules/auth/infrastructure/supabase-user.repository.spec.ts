import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { DataAccessError } from "./data-access-error";
import { SupabaseUserRepository } from "./supabase-user.repository";

const USER = {
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
  passwordHash: "$argon2id$hash",
};
const TOKEN = { tokenHash: "abc123", expiresAt: new Date("2026-11-10T12:00:00.000Z") };

function repositoryWith(response: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(response);
  const repository = new SupabaseUserRepository({ rpc } as unknown as SupabaseClient);

  return { repository, rpc };
}

describe("SupabaseUserRepository", () => {
  it("calls auth_sign_up with the user, the token hash and the ISO expiry", async () => {
    const { repository, rpc } = repositoryWith({ data: "user-id", error: null });

    const result = await repository.createWithConfirmationToken(USER, TOKEN);

    expect(result).toEqual({ status: "created", userId: "user-id" });
    expect(rpc).toHaveBeenCalledWith("auth_sign_up", {
      p_first_name: "Ana",
      p_last_name: "Silva",
      p_email: "ana@example.test",
      p_password_hash: "$argon2id$hash",
      p_token_hash: "abc123",
      p_token_expires_at: "2026-11-10T12:00:00.000Z",
    });
  });

  it("maps a null result to email_taken", async () => {
    const { repository } = repositoryWith({ data: null, error: null });

    await expect(repository.createWithConfirmationToken(USER, TOKEN)).resolves.toEqual({
      status: "email_taken",
    });
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { code: "XX000", message: "duplicate key value (email)=(ana@example.test)" },
    });

    const failure = await repository
      .createWithConfirmationToken(USER, TOKEN)
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_sign_up", code: "XX000" });
    expect(String((failure as Error).message)).not.toContain("ana@example.test");
  });

  it("rejects a result that is not an id", async () => {
    const { repository } = repositoryWith({ data: { id: 1 }, error: null });

    await expect(repository.createWithConfirmationToken(USER, TOKEN)).rejects.toBeInstanceOf(
      DataAccessError,
    );
  });
});
