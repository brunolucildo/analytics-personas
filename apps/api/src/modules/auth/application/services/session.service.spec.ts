import { decodeJwt } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "../../../../../test/support/in-memory-sessions";
import { SessionUserNotFoundError } from "../../domain/session-errors";
import type { SessionUser } from "../../domain/session-ports";
import { SESSION_TTL_MS } from "../../domain/session-rules";
import { JoseAccessTokenSigner } from "../../infrastructure/jose-access-token-signer";
import { SessionService } from "./session.service";

const SECRET = "unit-test-jwt-secret-0123456789-abcdefghij";
const NOW = new Date("2026-11-09T12:00:00.000Z");
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

describe("SessionService", () => {
  let repository: InMemorySessionRepository;
  let signer: JoseAccessTokenSigner;
  let now: Date;
  let service: SessionService;

  beforeEach(() => {
    now = new Date(NOW);
    repository = new InMemorySessionRepository([ANA, BIA]);
    signer = new JoseAccessTokenSigner(SECRET);
    service = new SessionService(repository, signer, () => now);
  });

  describe("issue", () => {
    it("returns the access token, the expiry 7 days ahead and the user", async () => {
      const issued = await service.issue(ANA.id);

      expect(issued.user).toEqual(ANA);
      expect(issued.expiresAt).toEqual(new Date(NOW.getTime() + SESSION_TTL_MS));

      const claims = decodeJwt(issued.accessToken);

      expect(claims.sub).toBe(ANA.id);
      expect(claims.sid).toBe(repository.sessions[0]?.id);
      expect(claims.iat).toBe(NOW.getTime() / 1000);
      expect(claims.exp).toBe((NOW.getTime() + SESSION_TTL_MS) / 1000);
    });

    it("carries no personal data in the token", async () => {
      const { accessToken } = await service.issue(ANA.id);

      expect(Object.keys(decodeJwt(accessToken)).sort()).toEqual(["exp", "iat", "sid", "sub"]);
      expect(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()).not.toContain(
        "ana@example.test",
      );
    });

    it("leaves only the last session active for the same user", async () => {
      const first = await service.issue(ANA.id);
      const second = await service.issue(ANA.id);
      const active = repository.sessions.filter((session) => session.revokedAt === null);

      expect(active).toHaveLength(1);
      expect(active[0]?.id).toBe(decodeJwt(second.accessToken).sid);
      expect(await service.authenticate(first.accessToken)).toBeNull();
      expect(await service.authenticate(second.accessToken)).toMatchObject({ userId: ANA.id });
    });

    it("does not touch the sessions of other users", async () => {
      const ana = await service.issue(ANA.id);

      await service.issue(BIA.id);

      expect(await service.authenticate(ana.accessToken)).toMatchObject({ userId: ANA.id });
    });

    it("throws SessionUserNotFoundError for an unknown user and stores nothing", async () => {
      await expect(service.issue("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(
        SessionUserNotFoundError,
      );
      expect(repository.sessions).toEqual([]);
    });
  });

  describe("validate", () => {
    it("returns the active session with its user", async () => {
      const { accessToken } = await service.issue(ANA.id);
      const sid = String(decodeJwt(accessToken).sid);

      expect(await service.validate(sid)).toEqual({ sessionId: sid, userId: ANA.id, user: ANA });
    });

    it("returns null for an unknown session", async () => {
      expect(await service.validate("00000000-0000-4000-8000-000000000000")).toBeNull();
    });

    it("returns null once the session expired", async () => {
      const { accessToken } = await service.issue(ANA.id);
      const sid = String(decodeJwt(accessToken).sid);

      now = new Date(NOW.getTime() + SESSION_TTL_MS);

      expect(await service.validate(sid)).toBeNull();
    });
  });

  describe("revoke", () => {
    it("invalidates the session right away and is idempotent", async () => {
      const { accessToken } = await service.issue(ANA.id);
      const sid = String(decodeJwt(accessToken).sid);

      await service.revoke(sid);
      await service.revoke(sid);

      expect(await service.validate(sid)).toBeNull();
      expect(await service.authenticate(accessToken)).toBeNull();
    });
  });

  describe("authenticate", () => {
    it("accepts a token whose session is active", async () => {
      const { accessToken } = await service.issue(ANA.id);

      expect(await service.authenticate(accessToken)).toMatchObject({ userId: ANA.id, user: ANA });
    });

    it("rejects a signed token whose session does not exist", async () => {
      const token = await signer.sign(
        { sub: ANA.id, sid: "00000000-0000-4000-8000-000000000000" },
        NOW,
        new Date(NOW.getTime() + 60_000),
      );

      expect(await service.authenticate(token)).toBeNull();
    });

    it("rejects a token whose subject is not the owner of the session", async () => {
      const { accessToken } = await service.issue(ANA.id);
      const sid = String(decodeJwt(accessToken).sid);
      const forged = await signer.sign({ sub: BIA.id, sid }, NOW, new Date(NOW.getTime() + 60_000));

      expect(await service.authenticate(forged)).toBeNull();
    });

    it("rejects a token signed with another secret", async () => {
      const { accessToken } = await service.issue(ANA.id);
      const sid = String(decodeJwt(accessToken).sid);
      const other = new JoseAccessTokenSigner("another-secret-0123456789-abcdefghijklmnop");
      const forged = await other.sign({ sub: ANA.id, sid }, NOW, new Date(NOW.getTime() + 60_000));

      expect(await service.authenticate(forged)).toBeNull();
    });

    it("rejects garbage", async () => {
      expect(await service.authenticate("not-a-jwt")).toBeNull();
    });
  });
});
