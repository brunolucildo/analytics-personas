import { describe, expect, it, vi } from "vitest";
import { EmailServicePasswordResetMailer } from "./email-service-password-reset-mailer";

const APP_URL = "http://localhost:5173";

describe("EmailServicePasswordResetMailer", () => {
  it("dispatches a message to the user with the reset link built from APP_URL", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const mailer = new EmailServicePasswordResetMailer({ dispatch }, APP_URL);

    await mailer.sendPasswordReset({ to: "ana@example.test", firstName: "Ana", token: "tok_en-1" });

    expect(dispatch).toHaveBeenCalledTimes(1);

    const message = dispatch.mock.calls[0]?.[0];

    expect(message.to).toBe("ana@example.test");
    expect(message.text).toContain(`${APP_URL}/auth/reset-password?token=tok_en-1`);
  });

  it("swallows a dispatch failure and logs it without the address or the token", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("boom for ana@example.test tok_en-1"));
    const logger = { error: vi.fn() };
    const mailer = new EmailServicePasswordResetMailer({ dispatch }, APP_URL, logger);

    await expect(
      mailer.sendPasswordReset({ to: "ana@example.test", firstName: "Ana", token: "tok_en-1" }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { event: "password_reset_email_failed" },
      "password_reset_email_failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/ana@example|tok_en-1/);
  });
});
