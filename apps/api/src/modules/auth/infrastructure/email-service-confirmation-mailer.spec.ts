import { describe, expect, it, vi } from "vitest";
import { EmailServiceConfirmationMailer } from "./email-service-confirmation-mailer";

const APP_URL = "http://localhost:5173";

describe("EmailServiceConfirmationMailer", () => {
  it("dispatches a message to the user with the confirmation link built from APP_URL", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const mailer = new EmailServiceConfirmationMailer({ dispatch }, APP_URL);

    await mailer.sendConfirmation({ to: "ana@example.test", firstName: "Ana", token: "tok_en-1" });

    expect(dispatch).toHaveBeenCalledTimes(1);

    const message = dispatch.mock.calls[0]?.[0];

    expect(message.to).toBe("ana@example.test");
    expect(message.text).toContain(`${APP_URL}/auth/confirm-account?token=tok_en-1`);
  });

  it("swallows a dispatch failure and logs it without the address or the token", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("boom for ana@example.test tok_en-1"));
    const logger = { error: vi.fn() };
    const mailer = new EmailServiceConfirmationMailer({ dispatch }, APP_URL, logger);

    await expect(
      mailer.sendConfirmation({ to: "ana@example.test", firstName: "Ana", token: "tok_en-1" }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { event: "confirmation_email_failed" },
      "confirmation_email_failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/ana@example|tok_en-1/);
  });
});
