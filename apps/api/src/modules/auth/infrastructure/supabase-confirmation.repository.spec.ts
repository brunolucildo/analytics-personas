import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { DataAccessError } from "./data-access-error";
import { SupabaseConfirmationRepository } from "./supabase-confirmation.repository";

const TOKEN = { tokenHash: "abc123", expiresAt: new Date("2026-11-10T12:00:00.000Z") };

function repositoryWith(response: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(response);
  const repository = new SupabaseConfirmationRepository({ rpc } as unknown as SupabaseClient);

  return { repository, rpc };
}

describe("SupabaseConfirmationRepository.confirmByTokenHash", () => {
  it("calls auth_confirm_account with the token hash and returns the user id", async () => {
    const { repository, rpc } = repositoryWith({ data: "user-1", error: null });

    await expect(repository.confirmByTokenHash("abc123")).resolves.toBe("user-1");
    expect(rpc).toHaveBeenCalledWith("auth_confirm_account", { p_token_hash: "abc123" });
  });

  it("resolves null when the function found no usable token", async () => {
    const { repository } = repositoryWith({ data: null, error: null });

    await expect(repository.confirmByTokenHash("abc123")).resolves.toBeNull();
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { code: "XX000", message: "failure for abc123" },
    });

    const failure = await repository.confirmByTokenHash("abc123").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_confirm_account", code: "XX000" });
    expect((failure as Error).message).not.toContain("abc123");
  });

  it("rejects a result that is neither null nor an id", async () => {
    const { repository } = repositoryWith({ data: { oops: true }, error: null });

    await expect(repository.confirmByTokenHash("abc123")).rejects.toMatchObject({
      code: "UNEXPECTED_RESULT",
    });
  });
});

describe("SupabaseConfirmationRepository.renewForUnconfirmedUser", () => {
  it("calls auth_resend_confirmation with the e-mail, the token hash and the ISO expiry", async () => {
    const { repository, rpc } = repositoryWith({ data: "Ana", error: null });

    const result = await repository.renewForUnconfirmedUser("ana@example.test", TOKEN);

    expect(result).toEqual({ status: "created", firstName: "Ana" });
    expect(rpc).toHaveBeenCalledWith("auth_resend_confirmation", {
      p_email: "ana@example.test",
      p_token_hash: "abc123",
      p_token_expires_at: "2026-11-10T12:00:00.000Z",
    });
  });

  it("maps a null result to no_action", async () => {
    const { repository } = repositoryWith({ data: null, error: null });

    await expect(repository.renewForUnconfirmedUser("ana@example.test", TOKEN)).resolves.toEqual({
      status: "no_action",
    });
  });

  it("throws a DataAccessError without the e-mail", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { code: "XX000", message: "failure for ana@example.test" },
    });

    const failure = await repository
      .renewForUnconfirmedUser("ana@example.test", TOKEN)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_resend_confirmation", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it("rejects a result that is neither null nor a name", async () => {
    const { repository } = repositoryWith({ data: 42, error: null });

    await expect(
      repository.renewForUnconfirmedUser("ana@example.test", TOKEN),
    ).rejects.toMatchObject({ code: "UNEXPECTED_RESULT" });
  });
});
