import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { DataAccessError } from "./data-access-error";
import { SupabasePasswordResetRepository } from "./supabase-password-reset.repository";

const TOKEN = { tokenHash: "abc123", expiresAt: new Date("2026-11-09T13:00:00.000Z") };

function repositoryWith(response: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(response);
  const repository = new SupabasePasswordResetRepository({ rpc } as unknown as SupabaseClient);

  return { repository, rpc };
}

describe("SupabasePasswordResetRepository", () => {
  it("calls auth_request_password_reset with the e-mail, the token hash and the ISO expiry", async () => {
    const { repository, rpc } = repositoryWith({ data: "Ana", error: null });

    const result = await repository.createForConfirmedUser("ana@example.test", TOKEN);

    expect(result).toEqual({ status: "created", firstName: "Ana" });
    expect(rpc).toHaveBeenCalledWith("auth_request_password_reset", {
      p_email: "ana@example.test",
      p_token_hash: "abc123",
      p_token_expires_at: "2026-11-09T13:00:00.000Z",
    });
  });

  it("maps a null result to no_action", async () => {
    const { repository } = repositoryWith({ data: null, error: null });

    await expect(repository.createForConfirmedUser("ana@example.test", TOKEN)).resolves.toEqual({
      status: "no_action",
    });
  });

  it("throws a DataAccessError that keeps the code but not the database message", async () => {
    const { repository } = repositoryWith({
      data: null,
      error: { code: "XX000", message: "failure for ana@example.test" },
    });

    const failure = await repository
      .createForConfirmedUser("ana@example.test", TOKEN)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataAccessError);
    expect(failure).toMatchObject({ operation: "auth_request_password_reset", code: "XX000" });
    expect((failure as Error).message).not.toContain("ana@example.test");
  });

  it("rejects a result that is neither null nor a name", async () => {
    const { repository } = repositoryWith({ data: { oops: true }, error: null });

    await expect(
      repository.createForConfirmedUser("ana@example.test", TOKEN),
    ).rejects.toMatchObject({ code: "UNEXPECTED_RESULT" });
  });
});
