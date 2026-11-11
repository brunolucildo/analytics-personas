import { beforeEach, describe, expect, it } from "vitest";
import {
  type FakeConfirmationAccount,
  InMemoryConfirmationRepository,
} from "../../../../../test/support/in-memory-confirmation";
import { InMemorySessionRepository } from "../../../../../test/support/in-memory-sessions";
import { InvalidConfirmationTokenError } from "../../domain/auth-errors";
import { ConfirmAccount } from "./confirm-account.use-case";
import { SessionService } from "../services/session.service";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const USER = {
  id: "user-1",
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
};

describe("ConfirmAccount", () => {
  let account: FakeConfirmationAccount;
  let confirmations: InMemoryConfirmationRepository;
  let sessions: InMemorySessionRepository;
  let confirmAccount: ConfirmAccount;

  beforeEach(() => {
    account = { id: USER.id, email: USER.email, firstName: USER.firstName, confirmed: false };
    confirmations = new InMemoryConfirmationRepository([account], () => NOW);
    confirmations.tokens.push({
      userId: USER.id,
      tokenHash: "hash:good",
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
      used: false,
    });
    sessions = new InMemorySessionRepository([USER]);

    const service = new SessionService(
      sessions,
      { sign: () => Promise.resolve("signed.jwt"), verify: () => Promise.resolve(null) },
      () => NOW,
    );

    confirmAccount = new ConfirmAccount(confirmations, service, {
      hash: (token) => `hash:${token}`,
    });
  });

  it("consumes the token, confirms the account and returns the issued session", async () => {
    const session = await confirmAccount.execute({ token: "good" });

    expect(session).toMatchObject({ accessToken: "signed.jwt", user: USER });
    expect(confirmations.tokens[0]?.used).toBe(true);
    expect(account.confirmed).toBe(true);
    expect(sessions.sessions).toHaveLength(1);
  });

  it("refuses an unknown token and starts no session", async () => {
    await expect(confirmAccount.execute({ token: "nope" })).rejects.toBeInstanceOf(
      InvalidConfirmationTokenError,
    );
    expect(sessions.sessions).toEqual([]);
    expect(account.confirmed).toBe(false);
  });

  it("refuses a token that was already used", async () => {
    await confirmAccount.execute({ token: "good" });

    await expect(confirmAccount.execute({ token: "good" })).rejects.toBeInstanceOf(
      InvalidConfirmationTokenError,
    );
    expect(sessions.sessions).toHaveLength(1);
  });

  it("refuses an expired token", async () => {
    confirmations.tokens.push({
      userId: USER.id,
      tokenHash: "hash:old",
      expiresAt: new Date(NOW.getTime() - 1),
      used: false,
    });

    await expect(confirmAccount.execute({ token: "old" })).rejects.toBeInstanceOf(
      InvalidConfirmationTokenError,
    );
    expect(sessions.sessions).toEqual([]);
  });

  it("revokes the previous session of the user", async () => {
    await sessions.issue(USER.id, new Date(NOW.getTime() + HOUR_MS));

    await confirmAccount.execute({ token: "good" });

    expect(sessions.sessions.map((session) => session.revokedAt !== null)).toEqual([true, false]);
  });
});
