import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "../../../../../test/support/in-memory-sessions";
import type { SessionUser } from "../../domain/session-ports";
import { JoseAccessTokenSigner } from "../../infrastructure/jose-access-token-signer";
import { SessionService } from "../services/session.service";
import { SignOut } from "./sign-out.use-case";

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

describe("SignOut", () => {
  let repository: InMemorySessionRepository;
  let sessions: SessionService;
  let signOut: SignOut;

  beforeEach(() => {
    repository = new InMemorySessionRepository([ANA, BIA]);
    sessions = new SessionService(
      repository,
      new JoseAccessTokenSigner("unit-test-jwt-secret-0123456789-abcdefghij"),
    );
    signOut = new SignOut(sessions);
  });

  it("revokes the given session so its token stops authenticating", async () => {
    const issued = await sessions.issue(ANA.id);
    const sessionId = repository.sessions[0]?.id as string;

    await signOut.execute(sessionId);

    expect(repository.sessions[0]?.revokedAt).not.toBeNull();
    expect(await sessions.authenticate(issued.accessToken)).toBeNull();
  });

  it("leaves the sessions of other users untouched", async () => {
    await sessions.issue(ANA.id);
    const bia = await sessions.issue(BIA.id);
    const anaSessionId = repository.sessions[0]?.id as string;

    await signOut.execute(anaSessionId);

    expect(repository.sessions[1]?.revokedAt).toBeNull();
    expect(await sessions.authenticate(bia.accessToken)).toMatchObject({ userId: BIA.id });
  });

  it("is idempotent: signing out twice, or an unknown session, does not fail", async () => {
    await sessions.issue(ANA.id);
    const sessionId = repository.sessions[0]?.id as string;

    await signOut.execute(sessionId);
    await expect(signOut.execute(sessionId)).resolves.toBeUndefined();
    await expect(signOut.execute("00000000-0000-4000-8000-000000000000")).resolves.toBeUndefined();
  });
});
