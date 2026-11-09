import { describe, expect, it, vi } from "vitest";
import { EmailServiceNewSessionMailer } from "./email-service-new-session-mailer";

const APP_URL = "http://localhost:5173";
const EMAIL = {
  to: "ana@example.test",
  firstName: "Ana",
  signedInAt: new Date("2026-11-09T19:15:30.000Z"),
};

describe("EmailServiceNewSessionMailer", () => {
  it("dispatches a message to the user with the forgot-password link built from APP_URL", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const mailer = new EmailServiceNewSessionMailer({ dispatch }, APP_URL);

    await mailer.sendNewSession(EMAIL);

    expect(dispatch).toHaveBeenCalledTimes(1);

    const message = dispatch.mock.calls[0]?.[0];

    expect(message.to).toBe("ana@example.test");
    expect(message.subject).toBe("New sign-in to Analytics Personas");
    expect(message.text).toContain(`${APP_URL}/auth/forgot-password`);
  });

  it("swallows a dispatch failure and logs it without the address", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("boom for ana@example.test"));
    const logger = { error: vi.fn() };
    const mailer = new EmailServiceNewSessionMailer({ dispatch }, APP_URL, logger);

    await expect(mailer.sendNewSession(EMAIL)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { event: "new_session_email_failed" },
      "new_session_email_failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("ana@example");
  });
});
