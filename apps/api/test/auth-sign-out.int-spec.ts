import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { decodeJwt } from "jose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { SessionService } from "../src/modules/auth/application/services/session.service";
import { resetRateLimitStore } from "./support/rate-limit";
import { seedConfirmedUser, sessionsOf } from "./support/sessions";
import { assertMigrationsApplied, deleteUsersByEmail } from "./support/database";

const SIGN_OUT_PATH = "/api/v1/auth/sign-out";
const SESSION_PATH = "/api/v1/auth/session";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("POST /api/v1/auth/sign-out", () => {
  const createdEmails: string[] = [];
  let app: INestApplication;
  let sessions: SessionService;

  async function newUser(label: string) {
    const user = await seedConfirmedUser(label);

    createdEmails.push(user.email);
    return user;
  }

  beforeAll(async () => {
    await assertMigrationsApplied();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    sessions = app.get(SessionService);
  });

  afterAll(async () => {
    await app.close();
    await deleteUsersByEmail(createdEmails);
  });

  beforeEach(() => {
    resetRateLimitStore(app);
  });

  describe("R1: revokes the current session", () => {
    it("answers 204 without a body, fills revoked_at and makes the token answer 401", async () => {
      const user = await newUser("sign-out");
      const { accessToken } = await sessions.issue(user.id);
      const http = request(app.getHttpServer());

      expect((await http.get(SESSION_PATH).set(bearer(accessToken))).status).toBe(200);

      const response = await http.post(SIGN_OUT_PATH).set(bearer(accessToken));

      expect(response.status).toBe(204);
      expect(response.text).toBe("");
      expect(response.body).toEqual({});

      const rows = await sessionsOf(user.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(decodeJwt(accessToken).sid);
      expect(rows[0]?.revoked_at).not.toBeNull();

      const after = await http.get(SESSION_PATH).set(bearer(accessToken));

      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("answers 401 when the same token signs out a second time", async () => {
      const user = await newUser("sign-out-twice");
      const { accessToken } = await sessions.issue(user.id);
      const http = request(app.getHttpServer());

      expect((await http.post(SIGN_OUT_PATH).set(bearer(accessToken))).status).toBe(204);

      const second = await http.post(SIGN_OUT_PATH).set(bearer(accessToken));

      expect(second.status).toBe(401);
      expect(second.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("lets the user start a new session afterwards", async () => {
      const user = await newUser("sign-out-then-in");
      const first = await sessions.issue(user.id);
      const http = request(app.getHttpServer());

      await http.post(SIGN_OUT_PATH).set(bearer(first.accessToken));

      const second = await sessions.issue(user.id);

      expect((await http.get(SESSION_PATH).set(bearer(second.accessToken))).status).toBe(200);
      expect(
        (await sessionsOf(user.id)).filter((row) => row.revoked_at === null),
      ).toHaveLength(1);
    });
  });

  describe("R2: requires a session", () => {
    const unauthenticated = {
      error: { code: "UNAUTHENTICATED", message: "Authentication required.", details: [] },
    };

    it("answers 401 UNAUTHENTICATED without a token", async () => {
      const response = await request(app.getHttpServer()).post(SIGN_OUT_PATH);

      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it("answers 401 UNAUTHENTICATED for an invalid token", async () => {
      const response = await request(app.getHttpServer())
        .post(SIGN_OUT_PATH)
        .set(bearer("not.a.token"));

      expect(response.status).toBe(401);
      expect(response.body).toEqual(unauthenticated);
    });

    it("does not touch the session of another user", async () => {
      const ana = await newUser("sign-out-ana");
      const bia = await newUser("sign-out-bia");
      const anaSession = await sessions.issue(ana.id);
      const biaSession = await sessions.issue(bia.id);
      const http = request(app.getHttpServer());

      expect((await http.post(SIGN_OUT_PATH).set(bearer(anaSession.accessToken))).status).toBe(204);

      const biaRows = await sessionsOf(bia.id);

      expect(biaRows).toHaveLength(1);
      expect(biaRows[0]?.revoked_at).toBeNull();
      expect((await http.get(SESSION_PATH).set(bearer(biaSession.accessToken))).status).toBe(200);
    });
  });
});
