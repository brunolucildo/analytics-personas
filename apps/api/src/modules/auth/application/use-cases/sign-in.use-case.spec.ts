import { beforeEach, describe, expect, it } from "vitest";
import {
  FakePasswordVerifier,
  InMemoryCredentialsRepository,
  RecordingNewSessionMailer,
} from "../../../../../test/support/in-memory-sign-in";
import { InMemorySessionRepository } from "../../../../../test/support/in-memory-sessions";
import { EmailNotConfirmedError, InvalidCredentialsError } from "../../domain/auth-errors";
import type { SessionUser } from "../../domain/session-ports";
import { JoseAccessTokenSigner } from "../../infrastructure/jose-access-token-signer";
import { SessionService } from "../services/session.service";
import { SignIn } from "./sign-in.use-case";

const NOW = new Date("2026-11-09T19:15:30.000Z");
const ANA: SessionUser = {
  id: "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b",
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
};
const BIA: SessionUser = {
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  firstName: "Bia",
  lastName: "Souza",
  email: "bia@example.test",
};

describe("SignIn", () => {
  let sessionsRepository: InMemorySessionRepository;
  let verifier: FakePasswordVerifier;
  let mailer: RecordingNewSessionMailer;
  let signIn: SignIn;

  beforeEach(() => {
    sessionsRepository = new InMemorySessionRepository([ANA, BIA]);
    verifier = new FakePasswordVerifier();
    mailer = new RecordingNewSessionMailer();

    const sessions = new SessionService(
      sessionsRepository,
      new JoseAccessTokenSigner("unit-test-jwt-secret-0123456789-abcdefghij"),
    );

    signIn = new SignIn(
      new InMemoryCredentialsRepository([
        {
          email: ANA.email,
          userId: ANA.id,
          passwordHash: "hashed:correct horse",
          emailConfirmed: true,
        },
        {
          email: BIA.email,
          userId: BIA.id,
          passwordHash: "hashed:another password",
          emailConfirmed: false,
        },
      ]),
      verifier,
      sessions,
      mailer,
      () => NOW,
    );
  });

  it("opens a session for the right password and mails the notice afterwards", async () => {
    const session = await signIn.execute({ email: ANA.email, password: "correct horse" });

    expect(session.user).toEqual(ANA);
    expect(session.accessToken.split(".")).toHaveLength(3);
    expect(sessionsRepository.sessions.filter((stored) => stored.revokedAt === null)).toHaveLength(
      1,
    );
    expect(mailer.sent).toEqual([{ to: ANA.email, firstName: "Ana", signedInAt: NOW }]);
  });

  it("revokes the previous session of the same user", async () => {
    await signIn.execute({ email: ANA.email, password: "correct horse" });
    await signIn.execute({ email: ANA.email, password: "correct horse" });

    expect(sessionsRepository.sessions.map((stored) => stored.revokedAt === null)).toEqual([
      false,
      true,
    ]);
    expect(mailer.sent).toHaveLength(2);
  });

  it("answers InvalidCredentialsError for a wrong password, without session or mail", async () => {
    await expect(
      signIn.execute({ email: ANA.email, password: "nope nope" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(sessionsRepository.sessions).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("answers the same error for an unknown e-mail and still runs the hash check", async () => {
    const failure = await signIn
      .execute({ email: "nobody@example.test", password: "correct horse" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidCredentialsError);
    expect((failure as Error).message).toBe("Invalid email or password.");
    expect(verifier.calls).toEqual([{ plain: "correct horse", hash: null }]);
    expect(sessionsRepository.sessions).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });

  it("tells an unconfirmed account only when the password is right", async () => {
    await expect(
      signIn.execute({ email: BIA.email, password: "another password" }),
    ).rejects.toBeInstanceOf(EmailNotConfirmedError);
    await expect(signIn.execute({ email: BIA.email, password: "wrong" })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );

    expect(sessionsRepository.sessions).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });
});
