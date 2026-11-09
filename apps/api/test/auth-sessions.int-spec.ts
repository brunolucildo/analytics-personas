import { Controller, Get, type INestApplication } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Test } from "@nestjs/testing";
import { decodeJwt, SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { SessionService } from "../src/modules/auth/application/session.service";
import { SESSION_TTL_MS } from "../src/modules/auth/domain/session-rules";
import {
  AUTH_RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICIES,
  RateLimit,
} from "../src/modules/rate-limit";
import { resetRateLimitStore } from "./support/rate-limit";
import { seedConfirmedUser, sessionsOf, type SeededUser } from "./support/sessions";
import { assertMigrationsApplied, createAdminClient, deleteUsersByEmail } from "./support/supabase";

const SESSION_PATH = "/api/v1/auth/session";
const SECRET = process.env.AUTH_JWT_SECRET as string;

/** A route that nobody marked `@Public()`: it must be closed by default. */
@Controller("probe")
class ClosedProbeController {
  @Get("closed")
  closed() {
    return { reached: true };
  }

  @Get("limited")
  @RateLimit("probe-ip")
  limited() {
    return { reached: true };
  }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("sessions and the route guard", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];
  let app: INestApplication;
  let sessions: SessionService;

  async function newUser(label: string, names?: { firstName: string; lastName: string }) {
    const user = await seedConfirmedUser(admin, label, names);

    createdEmails.push(user.email);
    return user;
  }

  function signed(
    claims: Record<string, unknown>,
    { subject, expiresInSeconds = 600 }: { subject?: string; expiresInSeconds?: number } = {},
    secret = SECRET,
  ) {
    let builder = new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds);

    if (subject !== undefined) {
      builder = builder.setSubject(subject);
    }

    return builder.sign(new TextEncoder().encode(secret));
  }

  beforeAll(async () => {
    await assertMigrationsApplied(admin);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ClosedProbeController],
    })
      .overrideProvider(RATE_LIMIT_POLICIES)
      .useValue({
        ...AUTH_RATE_LIMIT_POLICIES,
        "probe-ip": { limit: 2, windowSeconds: 60, keyBy: "ip" },
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    await app.close();
    await deleteUsersByEmail(admin, createdEmails);
  });

  beforeEach(() => {
    resetRateLimitStore(app);
  });

  describe("R2: issue, validate and revoke against the database", () => {
    it("issues a response with a 7 day JWT, and exactly one active row", async () => {
      const user = await newUser("issue");
      const before = Date.now();
      const issued = await sessions.issue(user.id);
      const claims = decodeJwt(issued.accessToken);
      const rows = await sessionsOf(admin, user.id);

      expect(issued.user).toEqual({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      });
      expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "sid", "sub"]);
      expect(claims.sub).toBe(user.id);
      expect(claims.sid).toBe(rows[0]?.id);
      expect((claims.exp as number) - (claims.iat as number)).toBe(SESSION_TTL_MS / 1000);
      expect(issued.expiresAt.getTime() - before).toBeGreaterThan(SESSION_TTL_MS - 60_000);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.revoked_at).toBeNull();
    });

    it("revokes the previous session when a new one is issued", async () => {
      const user = await newUser("issue-twice");
      const first = await sessions.issue(user.id);
      const second = await sessions.issue(user.id);
      const rows = await sessionsOf(admin, user.id);

      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.revoked_at === null).map((row) => row.id)).toEqual([
        decodeJwt(second.accessToken).sid,
      ]);
      expect(await sessions.authenticate(first.accessToken)).toBeNull();
      expect(await sessions.authenticate(second.accessToken)).toMatchObject({ userId: user.id });
    });

    it("never leaves two active sessions when issues run at the same time", async () => {
      const user = await newUser("issue-race");
      const results = await Promise.all(Array.from({ length: 6 }, () => sessions.issue(user.id)));
      const rows = await sessionsOf(admin, user.id);
      const active = rows.filter((row) => row.revoked_at === null);

      expect(rows).toHaveLength(6);
      expect(active).toHaveLength(1);

      const valid = await Promise.all(
        results.map((result) => sessions.authenticate(result.accessToken)),
      );

      expect(valid.filter((session) => session !== null)).toHaveLength(1);
    });

    it("revokes a session on demand", async () => {
      const user = await newUser("revoke");
      const issued = await sessions.issue(user.id);

      await sessions.revoke(String(decodeJwt(issued.accessToken).sid));

      expect(await sessions.authenticate(issued.accessToken)).toBeNull();
      expect((await sessionsOf(admin, user.id))[0]?.revoked_at).not.toBeNull();
    });

    it("fails for a user that does not exist", async () => {
      await expect(sessions.issue("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({
        name: "SessionUserNotFoundError",
      });
    });
  });

  describe("R4: the API is closed by default", () => {
    const unauthenticated = {
      error: { code: "UNAUTHENTICATED", message: "Authentication required.", details: [] },
    };

    it("answers 401 UNAUTHENTICATED on a route without @Public() when there is no token", async () => {
      const response = await request(app.getHttpServer()).get("/api/v1/probe/closed");

      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it("lets a valid token reach the same route", async () => {
      const user = await newUser("closed-ok");
      const { accessToken } = await sessions.issue(user.id);
      const response = await request(app.getHttpServer())
        .get("/api/v1/probe/closed")
        .set(bearer(accessToken));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ reached: true });
    });

    it("keeps GET /api/v1/health public, even with a garbage token", async () => {
      const http = request(app.getHttpServer());

      expect((await http.get("/api/v1/health")).status).toBe(200);
      expect((await http.get("/api/v1/health").set(bearer("garbage"))).status).toBe(200);
    });

    it("keeps POST /api/v1/auth/sign-up public (it answers validation, not 401)", async () => {
      const response = await request(app.getHttpServer()).post("/api/v1/auth/sign-up").send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("answers 404, not 401, for a route that does not exist", async () => {
      const response = await request(app.getHttpServer()).get("/api/v1/does-not-exist");

      expect(response.status).toBe(404);
    });

    describe("every kind of bad token gets the same answer", () => {
      let user: SeededUser;
      let validSid: string;

      beforeAll(async () => {
        user = await newUser("bad-tokens");
        validSid = String(decodeJwt((await sessions.issue(user.id)).accessToken).sid);
      });

      const headerCases: Array<[string, Record<string, string>]> = [
        ["no Authorization header", {}],
        ["an empty bearer token", { authorization: "Bearer " }],
        ["a non bearer scheme", { authorization: "Basic dXNlcjpwYXNz" }],
        ["a malformed token", bearer("not-a-jwt")],
      ];

      it.each(headerCases)("rejects %s", async (_label, headers) => {
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(headers);

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a token signed with another secret", async () => {
        const token = await signed(
          { sid: validSid },
          { subject: user.id },
          "another-secret-0123456789-abcdefghijklmnop",
        );
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(token));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects an expired token of a session that is still active", async () => {
        const token = await signed({ sid: validSid }, { subject: user.id, expiresInSeconds: -60 });
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(token));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a validly signed token without sid", async () => {
        const token = await signed({}, { subject: user.id });
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(token));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a validly signed token of a session that does not exist", async () => {
        const token = await signed(
          { sid: "00000000-0000-4000-8000-000000000000" },
          { subject: user.id },
        );
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(token));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a validly signed token whose sid is not a UUID", async () => {
        const token = await signed({ sid: "x' or '1'='1" }, { subject: user.id });
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(token));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a token that names another user's id as subject", async () => {
        const other = await newUser("bad-tokens-other");
        const token = await signed({ sid: validSid }, { subject: other.id });
        const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(token));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a token whose session was revoked", async () => {
        const revoked = await newUser("bad-tokens-revoked");
        const { accessToken } = await sessions.issue(revoked.id);

        await sessions.revoke(String(decodeJwt(accessToken).sid));

        const response = await request(app.getHttpServer())
          .get(SESSION_PATH)
          .set(bearer(accessToken));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a token whose session expired in the database", async () => {
        const expired = await newUser("bad-tokens-expired");
        const { accessToken } = await sessions.issue(expired.id);

        await admin
          .from("sessions")
          .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
          .eq("user_id", expired.id);

        const response = await request(app.getHttpServer())
          .get(SESSION_PATH)
          .set(bearer(accessToken));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });

      it("rejects a token once its user was deleted", async () => {
        const gone = await newUser("bad-tokens-deleted");
        const { accessToken } = await sessions.issue(gone.id);

        await deleteUsersByEmail(admin, [gone.email]);

        const response = await request(app.getHttpServer())
          .get(SESSION_PATH)
          .set(bearer(accessToken));

        expect(response.status).toBe(401);
        expect(response.body).toEqual(unauthenticated);
      });
    });

    it("runs the rate limit before authentication (the 3rd anonymous call gets 429, not 401)", async () => {
      const http = request(app.getHttpServer());

      expect((await http.get("/api/v1/probe/limited")).status).toBe(401);
      expect((await http.get("/api/v1/probe/limited")).status).toBe(401);

      const limited = await http.get("/api/v1/probe/limited");

      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("R5: GET /api/v1/auth/session", () => {
    it("answers 200 with only the public user fields", async () => {
      const user = await newUser("session-ok", { firstName: "Bianca", lastName: "Souza" });
      const { accessToken } = await sessions.issue(user.id);
      const response = await request(app.getHttpServer())
        .get(SESSION_PATH)
        .set(bearer(accessToken));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        user: { id: user.id, firstName: "Bianca", lastName: "Souza", email: user.email },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/password|hash|argon2|sid|accessToken/i);
    });

    it("answers 401 without a token", async () => {
      const response = await request(app.getHttpServer()).get(SESSION_PATH);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("R6: a single session per user, end to end", () => {
    it("rejects token A and accepts token B after B is issued for the same user", async () => {
      const user = await newUser("single-session");
      const a = await sessions.issue(user.id);
      const b = await sessions.issue(user.id);
      const http = request(app.getHttpServer());

      const withA = await http.get(SESSION_PATH).set(bearer(a.accessToken));
      const withB = await http.get(SESSION_PATH).set(bearer(b.accessToken));

      expect(withA.status).toBe(401);
      expect(withA.body.error.code).toBe("UNAUTHENTICATED");
      expect(withB.status).toBe(200);
      expect(withB.body.user.id).toBe(user.id);
    });

    it("keeps the sessions of different users independent", async () => {
      const ana = await newUser("independent-a");
      const bia = await newUser("independent-b");
      const anaToken = (await sessions.issue(ana.id)).accessToken;

      await sessions.issue(bia.id);

      const response = await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(anaToken));

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(ana.id);
    });
  });
});
