import { beforeEach, describe, expect, it } from "vitest";
import { FakeTokenGenerator } from "../../../../test/support/in-memory-auth";
import {
  InMemoryPasswordResetRepository,
  RecordingPasswordResetMailer,
} from "../../../../test/support/in-memory-password-reset";
import { PASSWORD_RESET_TOKEN_TTL_MS } from "../domain/auth-rules";
import { RequestPasswordReset } from "./request-password-reset";

const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("RequestPasswordReset", () => {
  let resets: InMemoryPasswordResetRepository;
  let mailer: RecordingPasswordResetMailer;
  let requestReset: RequestPasswordReset;

  beforeEach(() => {
    resets = new InMemoryPasswordResetRepository([
      { email: "ana@example.test", firstName: "Ana", confirmed: true },
      { email: "bia@example.test", firstName: "Bia", confirmed: false },
    ]);
    mailer = new RecordingPasswordResetMailer();
    requestReset = new RequestPasswordReset(resets, new FakeTokenGenerator(), mailer, () => NOW);
  });

  it("stores a one hour token and mails the link token to a confirmed account", async () => {
    await expect(requestReset.execute({ email: "ana@example.test" })).resolves.toBeUndefined();

    expect(resets.tokens).toEqual([
      {
        email: "ana@example.test",
        tokenHash: "hash-1",
        expiresAt: new Date(NOW.getTime() + PASSWORD_RESET_TOKEN_TTL_MS),
        used: false,
      },
    ]);
    expect(mailer.sent).toEqual([{ to: "ana@example.test", firstName: "Ana", token: "token-1" }]);
  });

  it("does nothing for an unconfirmed account", async () => {
    await expect(requestReset.execute({ email: "bia@example.test" })).resolves.toBeUndefined();

    expect(resets.tokens).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("does nothing for an unknown e-mail", async () => {
    await expect(requestReset.execute({ email: "nobody@example.test" })).resolves.toBeUndefined();

    expect(resets.tokens).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("invalidates the earlier token when a new one is requested", async () => {
    await requestReset.execute({ email: "ana@example.test" });
    await requestReset.execute({ email: "ana@example.test" });

    expect(resets.tokens.map((token) => [token.tokenHash, token.used])).toEqual([
      ["hash-1", true],
      ["hash-2", false],
    ]);
    expect(mailer.sent.map((sent) => sent.token)).toEqual(["token-1", "token-2"]);
  });
});
