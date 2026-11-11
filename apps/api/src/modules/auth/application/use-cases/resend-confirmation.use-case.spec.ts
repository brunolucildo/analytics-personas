import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeTokenGenerator,
  RecordingConfirmationMailer,
} from "../../../../../test/support/in-memory-auth";
import { InMemoryConfirmationRepository } from "../../../../../test/support/in-memory-confirmation";
import { CONFIRMATION_TOKEN_TTL_MS } from "../../domain/auth-rules";
import { ResendConfirmation } from "./resend-confirmation.use-case";

const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("ResendConfirmation", () => {
  let confirmations: InMemoryConfirmationRepository;
  let mailer: RecordingConfirmationMailer;
  let resend: ResendConfirmation;

  beforeEach(() => {
    confirmations = new InMemoryConfirmationRepository([
      { id: "u1", email: "ana@example.test", firstName: "Ana", confirmed: false },
      { id: "u2", email: "bia@example.test", firstName: "Bia", confirmed: true },
    ]);
    mailer = new RecordingConfirmationMailer();
    resend = new ResendConfirmation(confirmations, new FakeTokenGenerator(), mailer, () => NOW);
  });

  it("stores a 24 hour token and mails the link token to an unconfirmed account", async () => {
    await expect(resend.execute({ email: "ana@example.test" })).resolves.toBeUndefined();

    expect(confirmations.tokens).toEqual([
      {
        userId: "u1",
        tokenHash: "hash-1",
        expiresAt: new Date(NOW.getTime() + CONFIRMATION_TOKEN_TTL_MS),
        used: false,
      },
    ]);
    expect(mailer.sent).toEqual([{ to: "ana@example.test", firstName: "Ana", token: "token-1" }]);
  });

  it("does nothing for a confirmed account", async () => {
    await expect(resend.execute({ email: "bia@example.test" })).resolves.toBeUndefined();

    expect(confirmations.tokens).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("does nothing for an unknown e-mail", async () => {
    await expect(resend.execute({ email: "nobody@example.test" })).resolves.toBeUndefined();

    expect(confirmations.tokens).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("invalidates the earlier link when a new one is requested", async () => {
    await resend.execute({ email: "ana@example.test" });
    await resend.execute({ email: "ana@example.test" });

    expect(confirmations.tokens.map((token) => [token.tokenHash, token.used])).toEqual([
      ["hash-1", true],
      ["hash-2", false],
    ]);
    expect(mailer.sent.map((sent) => sent.token)).toEqual(["token-1", "token-2"]);
  });
});
