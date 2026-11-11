import { beforeEach, describe, expect, it } from "vitest";
import { FakePasswordHasher } from "../../../../../test/support/in-memory-auth";
import {
  type FakeAccount,
  InMemoryPasswordResetRepository,
  RecordingPasswordChangedMailer,
} from "../../../../../test/support/in-memory-password-reset";
import { InvalidPasswordResetTokenError } from "../../domain/auth-errors";
import { ResetPassword } from "./reset-password.use-case";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

describe("ResetPassword", () => {
  let account: FakeAccount;
  let resets: InMemoryPasswordResetRepository;
  let mailer: RecordingPasswordChangedMailer;
  let resetPassword: ResetPassword;

  beforeEach(() => {
    account = { email: "ana@example.test", firstName: "Ana", confirmed: true };
    resets = new InMemoryPasswordResetRepository([account], () => NOW);
    resets.tokens.push(
      {
        email: account.email,
        tokenHash: "hash:good",
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
        used: false,
      },
      {
        email: account.email,
        tokenHash: "hash:other",
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
        used: false,
      },
      {
        email: account.email,
        tokenHash: "hash:expired",
        expiresAt: new Date(NOW.getTime() - 1),
        used: false,
      },
    );
    mailer = new RecordingPasswordChangedMailer();
    resetPassword = new ResetPassword(
      resets,
      new FakePasswordHasher(),
      mailer,
      { hash: (token) => `hash:${token}` },
      () => NOW,
    );
  });

  it("stores the new hash, uses the token and its siblings, revokes the sessions and mails the notice", async () => {
    await expect(
      resetPassword.execute({ token: "good", password: "brand new password" }),
    ).resolves.toBeUndefined();

    expect(account.passwordHash).toBe("hashed:brand new password");
    expect(resets.tokens.every((token) => token.used)).toBe(true);
    expect(resets.revokedSessionsOf).toEqual([account.email]);
    expect(mailer.sent).toEqual([{ to: account.email, firstName: "Ana", changedAt: NOW }]);
  });

  it.each([
    ["unknown", "nope"],
    ["expired", "expired"],
  ])("refuses an %s token, changes nothing and mails nobody", async (_label, token) => {
    await expect(
      resetPassword.execute({ token, password: "brand new password" }),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
    expect(account.passwordHash).toBeUndefined();
    expect(resets.revokedSessionsOf).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("refuses a token that was already used", async () => {
    await resetPassword.execute({ token: "good", password: "brand new password" });

    await expect(
      resetPassword.execute({ token: "good", password: "another password" }),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
    expect(account.passwordHash).toBe("hashed:brand new password");
    expect(mailer.sent).toHaveLength(1);
  });

  it("refuses the sibling token after the first one was used", async () => {
    await resetPassword.execute({ token: "good", password: "brand new password" });

    await expect(
      resetPassword.execute({ token: "other", password: "another password" }),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
  });
});
