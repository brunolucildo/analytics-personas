import { beforeEach, describe, expect, it } from "vitest";
import {
  FakePasswordHasher,
  FakeTokenGenerator,
  InMemoryUserRepository,
  RecordingConfirmationMailer,
} from "../../../../../test/support/in-memory-auth";
import { CONFIRMATION_TOKEN_TTL_MS } from "../../domain/auth-rules";
import { EmailAlreadyRegisteredError } from "../../domain/auth-errors";
import { SignUp } from "./sign-up.use-case";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const COMMAND = {
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
  password: "correct horse battery",
};

describe("SignUp", () => {
  let users: InMemoryUserRepository;
  let mailer: RecordingConfirmationMailer;
  let signUp: SignUp;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    mailer = new RecordingConfirmationMailer();
    signUp = new SignUp(
      users,
      new FakePasswordHasher(),
      new FakeTokenGenerator(),
      mailer,
      () => NOW,
    );
  });

  it("creates an unconfirmed user with the password hash and answers with the e-mail", async () => {
    const result = await signUp.execute(COMMAND);

    expect(result).toEqual({ email: "ana@example.test" });
    expect(users.users).toHaveLength(1);
    expect(users.users[0]).toMatchObject({
      firstName: "Ana",
      lastName: "Silva",
      email: "ana@example.test",
      passwordHash: "hashed:correct horse battery",
      emailConfirmedAt: null,
    });
    expect(JSON.stringify(users.users)).not.toContain('"password"');
  });

  it("stores only the token hash, expiring 24 hours after the sign-up", async () => {
    await signUp.execute(COMMAND);

    expect(users.tokens).toEqual([
      {
        userId: "user-1",
        tokenHash: "hash-1",
        expiresAt: new Date(NOW.getTime() + CONFIRMATION_TOKEN_TTL_MS),
      },
    ]);
    expect(JSON.stringify(users.tokens)).not.toContain("token-1");
  });

  it("sends the confirmation mail with the plain token to the new user", async () => {
    await signUp.execute(COMMAND);

    expect(mailer.sent).toEqual([{ to: "ana@example.test", firstName: "Ana", token: "token-1" }]);
  });

  it("rejects an e-mail that already has an account and sends nothing", async () => {
    await signUp.execute(COMMAND);
    mailer.sent.length = 0;

    await expect(signUp.execute({ ...COMMAND, firstName: "Other" })).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
    expect(users.users).toHaveLength(1);
    expect(mailer.sent).toEqual([]);
  });

  it("does not send the mail when the data layer fails", async () => {
    const failing = new InMemoryUserRepository();

    failing.createWithConfirmationToken = () => Promise.reject(new Error("database down"));

    const useCase = new SignUp(failing, new FakePasswordHasher(), new FakeTokenGenerator(), mailer);

    await expect(useCase.execute(COMMAND)).rejects.toThrow("database down");
    expect(mailer.sent).toEqual([]);
  });
});
