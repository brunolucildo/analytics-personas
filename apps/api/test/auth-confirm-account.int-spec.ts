import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { EmailDeliveryError, EmailService } from "../src/modules/email";
import {
  clearCapturedEmails,
  EMAIL_PROVIDER,
  getCapturedEmails,
} from "../src/modules/email/testing";
import { baseLogger } from "../src/observability/logger";
import { resetRateLimitStore } from "./support/rate-limit";
import { sessionsOf } from "./support/sessions";
import {
  assertMigrationsApplied,
  confirmAccount,
  deleteUsersByEmail,
  findUserById,
  insertToken,
  listTokensOfUser,
  query,
  resendConfirmation,
  signUp,
  uniqueEmail,
  type TokenRow,
} from "./support/database";

const CONFIRM_PATH = "/api/v1/auth/confirm-account";
const RESEND_PATH = "/api/v1/auth/resend-confirmation";
const SESSION_PATH = "/api/v1/auth/session";
const HOUR_MS = 60 * 60 * 1000;
const HEADERS_THAT_MAY_DIFFER = new Set(["date", "x-request-id"]);
const INVALID_BODY = {
  error: { code: "TOKEN_INVALID_OR_EXPIRED", message: "This link is invalid or has expired." },
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("confirm account and resend confirmation", () => {
  const createdEmails: string[] = [];
  let app: INestApplication;

  function newEmail(label: string): string {
    const email = uniqueEmail(label);

    createdEmails.push(email);
    return email;
  }

  /** Creates an unconfirmed account through the sign-up function, with a known link token. */
  async function createAccount(label: string, firstName = "Ana") {
    const email = newEmail(label);
    const token = newToken();
    const userId = await signUp({
      firstName,
      lastName: "Silva",
      email,
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
      tokenHash: sha256(token),
      tokenExpiresAt: new Date(Date.now() + 24 * HOUR_MS),
    });

    expect(userId).not.toBeNull();

    return { email, token, userId: userId as string };
  }

  /** Adds another token (any type, any expiry) to an existing user. */
  async function addToken(
    userId: string,
    type: "email_confirmation" | "password_reset",
    expiresInMs = 24 * HOUR_MS,
    usedAt: Date | null = null,
  ) {
    const token = newToken();

    await insertToken({
      userId,
      type,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + expiresInMs),
      usedAt,
    });

    return token;
  }

  async function userRow(userId: string) {
    const user = await findUserById(userId);

    return { email_confirmed_at: user?.email_confirmed_at ?? null, updated_at: user?.updated_at };
  }

  async function confirmationTokens(userId: string): Promise<TokenRow[]> {
    return listTokensOfUser(userId, "email_confirmation");
  }

  async function snapshot(userId: string) {
    const tokens = await query(
      "select * from public.auth_tokens where user_id = $1 order by token_hash",
      [userId],
    );

    return JSON.stringify({
      user: await userRow(userId),
      tokens: tokens.rows,
      sessions: await sessionsOf(userId),
    });
  }

  beforeAll(async () => {
    await assertMigrationsApplied();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await deleteUsersByEmail(createdEmails);
  });

  beforeEach(() => {
    resetRateLimitStore(app);
  });

  afterEach(() => {
    clearCapturedEmails();
    vi.restoreAllMocks();
  });

  describe("R1: a valid token confirms the account and opens the session", () => {
    it("answers 200 with the session, confirms the e-mail, uses the token and creates one active session", async () => {
      const { token, userId } = await createAccount("r1", "Bianca");
      const before = Date.now();
      const response = await request(app.getHttpServer()).post(CONFIRM_PATH).send({ token });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(["accessToken", "expiresAt", "user"]);
      expect(response.body.user).toMatchObject({
        id: userId,
        firstName: "Bianca",
        lastName: "Silva",
      });
      expect(JSON.stringify(response.body)).not.toContain("password");
      expect(new Date(response.body.expiresAt).getTime() - before).toBeGreaterThan(
        7 * 24 * HOUR_MS - 60_000,
      );

      expect((await userRow(userId)).email_confirmed_at).not.toBeNull();

      const [stored] = await confirmationTokens(userId);

      expect(stored?.used_at).not.toBeNull();

      const sessions = await sessionsOf(userId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.revoked_at).toBeNull();
    });

    it("returns an access token that the guard accepts", async () => {
      const { token } = await createAccount("r1-session");
      const confirmed = await request(app.getHttpServer()).post(CONFIRM_PATH).send({ token });
      const session = await request(app.getHttpServer())
        .get(SESSION_PATH)
        .set(bearer(confirmed.body.accessToken));

      expect(session.status).toBe(200);
      expect(session.body.user.email).toBe(confirmed.body.user.email);
    });

    it("sends no e-mail when the account is confirmed", async () => {
      const { email, token } = await createAccount("r1-no-mail");

      await request(app.getHttpServer()).post(CONFIRM_PATH).send({ token });
      await app.get(EmailService).drain();

      expect(getCapturedEmails({ to: email })).toEqual([]);
    });

    it("works even when the request carries an old or invalid bearer token", async () => {
      const { token } = await createAccount("r1-stale");
      const response = await request(app.getHttpServer())
        .post(CONFIRM_PATH)
        .set(bearer("stale.token.value"))
        .send({ token });

      expect(response.status).toBe(200);
    });
  });

  describe("R2: every bad token gets the same 400", () => {
    it("refuses an unknown token and changes nothing", async () => {
      const { userId } = await createAccount("r2-unknown");
      const before = await snapshot(userId);
      const response = await request(app.getHttpServer())
        .post(CONFIRM_PATH)
        .send({ token: newToken() });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject(INVALID_BODY);
      expect(response.body.error.details).toEqual([]);
      expect(await snapshot(userId)).toBe(before);
    });

    it("refuses an expired token and changes nothing", async () => {
      const { userId } = await createAccount("r2-expired");
      const expired = await addToken(userId, "email_confirmation", -HOUR_MS);
      const before = await snapshot(userId);
      const response = await request(app.getHttpServer())
        .post(CONFIRM_PATH)
        .send({ token: expired });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject(INVALID_BODY);
      expect(await snapshot(userId)).toBe(before);
    });

    it("refuses a token that was already used and changes nothing", async () => {
      const { token, userId } = await createAccount("r2-used");

      expect((await request(app.getHttpServer()).post(CONFIRM_PATH).send({ token })).status).toBe(
        200,
      );

      const before = await snapshot(userId);
      const again = await request(app.getHttpServer()).post(CONFIRM_PATH).send({ token });

      expect(again.status).toBe(400);
      expect(again.body).toMatchObject(INVALID_BODY);
      expect(await snapshot(userId)).toBe(before);
      expect(await sessionsOf(userId)).toHaveLength(1);
    });

    it("refuses a token of another type (password_reset) and changes nothing", async () => {
      const { userId } = await createAccount("r2-type");
      const resetToken = await addToken(userId, "password_reset");
      const before = await snapshot(userId);
      const response = await request(app.getHttpServer())
        .post(CONFIRM_PATH)
        .send({ token: resetToken });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject(INVALID_BODY);
      expect(await snapshot(userId)).toBe(before);
      expect((await userRow(userId)).email_confirmed_at).toBeNull();
    });

    it("gives the same body and headers for unknown, expired, used and wrong-type tokens", async () => {
      const { token, userId } = await createAccount("r2-same");
      const http = request(app.getHttpServer());

      await http.post(CONFIRM_PATH).send({ token });

      const bodies = [
        newToken(),
        await addToken(userId, "email_confirmation", -HOUR_MS),
        token,
        await addToken(userId, "password_reset"),
      ];
      const responses: request.Response[] = [];

      for (const body of bodies) {
        responses.push(await http.post(CONFIRM_PATH).send({ token: body }));
      }

      const comparable = (response: request.Response) =>
        JSON.stringify([
          response.status,
          response.text,
          Object.entries(response.headers)
            .filter(([name]) => !HEADERS_THAT_MAY_DIFFER.has(name))
            .filter(([name]) => !name.startsWith("x-ratelimit") && name !== "retry-after")
            .sort(([a], [b]) => a.localeCompare(b)),
        ]);

      for (const response of responses) {
        expect(comparable(response)).toBe(comparable(responses[0] as request.Response));
      }
    });

    it.each([
      ["a missing token", {}],
      ["an empty token", { token: "" }],
      ["a non-text token", { token: 7 }],
      ["an extra field", { token: "abc", isAdmin: true }],
    ])("rejects %s with 400 VALIDATION_FAILED", async (_label, body) => {
      const response = await request(app.getHttpServer()).post(CONFIRM_PATH).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("R3: a token works once, even under concurrency", () => {
    it("answers 200 to exactly one of two simultaneous requests and 400 to the other", async () => {
      const { token, userId } = await createAccount("r3");
      const send = () => request(app.getHttpServer()).post(CONFIRM_PATH).send({ token });
      const responses = await Promise.all([send(), send()]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);

      const rejected = responses.find((response) => response.status === 400);

      expect(rejected?.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
      expect(await sessionsOf(userId)).toHaveLength(1);
    });

    it("lets one of many simultaneous requests win", async () => {
      const { token } = await createAccount("r3-many");
      const send = () => request(app.getHttpServer()).post(CONFIRM_PATH).send({ token });
      const responses = await Promise.all([send(), send(), send(), send()]);
      const statuses = responses.map((response) => response.status);

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 400)).toHaveLength(3);
    });
  });

  describe("R4: the new session ends the previous one", () => {
    it("turns session A into 401 and keeps session B working", async () => {
      const { token, userId } = await createAccount("r4");
      const second = await addToken(userId, "email_confirmation");
      const http = request(app.getHttpServer());
      const a = await http.post(CONFIRM_PATH).send({ token });
      const b = await http.post(CONFIRM_PATH).send({ token: second });

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect((await http.get(SESSION_PATH).set(bearer(a.body.accessToken))).status).toBe(401);
      expect((await http.get(SESSION_PATH).set(bearer(b.body.accessToken))).status).toBe(200);

      const sessions = await sessionsOf(userId);

      expect(sessions.filter((session) => session.revoked_at === null)).toHaveLength(1);
    });
  });

  describe("R5: resend confirmation", () => {
    it("answers 202 {} with the same headers and bytes for unconfirmed, confirmed and unknown e-mails", async () => {
      const unconfirmed = await createAccount("r5-unconfirmed");
      const confirmed = await createAccount("r5-confirmed");
      const unknown = newEmail("r5-unknown");
      const http = request(app.getHttpServer());

      await http.post(CONFIRM_PATH).send({ token: confirmed.token });

      const responses: request.Response[] = [];

      for (const email of [unconfirmed.email, confirmed.email, unknown]) {
        responses.push(await http.post(RESEND_PATH).send({ email }));
      }

      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(response.body).toEqual({});
      }

      const comparable = (response: request.Response) =>
        JSON.stringify(
          Object.entries(response.headers)
            .filter(([name]) => !HEADERS_THAT_MAY_DIFFER.has(name))
            .filter(([name]) => !name.startsWith("x-ratelimit") && name !== "retry-after")
            .sort(([a], [b]) => a.localeCompare(b)),
        );

      expect(responses.map((response) => response.text)).toEqual(["{}", "{}", "{}"]);
      expect(comparable(responses[1] as request.Response)).toBe(
        comparable(responses[0] as request.Response),
      );
      expect(comparable(responses[2] as request.Response)).toBe(
        comparable(responses[0] as request.Response),
      );
    });

    it("mails a new link only to the unconfirmed account and invalidates the old one", async () => {
      const unconfirmed = await createAccount("r5-mail", "Carla");
      const confirmed = await createAccount("r5-mail-confirmed");
      const unknown = newEmail("r5-mail-unknown");
      const http = request(app.getHttpServer());

      await http.post(CONFIRM_PATH).send({ token: confirmed.token });

      for (const email of [unconfirmed.email, confirmed.email, unknown]) {
        expect((await http.post(RESEND_PATH).send({ email })).status).toBe(202);
      }

      await app.get(EmailService).drain();

      expect(getCapturedEmails({ to: confirmed.email })).toEqual([]);
      expect(getCapturedEmails({ to: unknown })).toEqual([]);

      const messages = getCapturedEmails({ to: unconfirmed.email });

      expect(messages).toHaveLength(1);

      const [message] = messages;
      const appUrl = process.env.APP_URL as string;
      const link = new RegExp(`${appUrl}/auth/confirm-account\\?token=([A-Za-z0-9_-]+)`);
      const newLinkToken = link.exec(message?.text ?? "")?.[1];

      expect(newLinkToken).toBeDefined();
      expect(message?.subject).toBe("Confirm your email address");
      expect(message?.text).toContain("Hi Carla,");
      expect(message?.html).toContain(`${appUrl}/auth/confirm-account?token=${newLinkToken}`);

      const tokens = await confirmationTokens(unconfirmed.userId);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.used_at).not.toBeNull();
      expect(tokens[1]?.used_at).toBeNull();
      expect(tokens[1]?.token_hash).toBe(sha256(newLinkToken as string));
      expect(JSON.stringify(tokens[1])).not.toContain(newLinkToken as string);

      const expiresIn = (tokens[1]?.expires_at.getTime() ?? 0) - Date.now();

      expect(expiresIn).toBeGreaterThan(24 * HOUR_MS - 60_000);
      expect(expiresIn).toBeLessThan(24 * HOUR_MS + 60_000);

      // The link of the sign-up no longer works; the new one does.
      const old = await http.post(CONFIRM_PATH).send({ token: unconfirmed.token });

      expect(old.status).toBe(400);

      const fresh = await http.post(CONFIRM_PATH).send({ token: newLinkToken });

      expect(fresh.status).toBe(200);
    });

    it("accepts the e-mail in another case and with spaces", async () => {
      const { email, userId } = await createAccount("r5-case");
      const response = await request(app.getHttpServer())
        .post(RESEND_PATH)
        .send({ email: `  ${email.toUpperCase()} ` });

      expect(response.status).toBe(202);
      expect(await confirmationTokens(userId)).toHaveLength(2);
    });

    it("leaves the password reset tokens of the account untouched", async () => {
      const { email, userId } = await createAccount("r5-reset");

      await addToken(userId, "password_reset");
      await request(app.getHttpServer()).post(RESEND_PATH).send({ email });

      const resetTokens = await listTokensOfUser(userId, "password_reset");

      expect(resetTokens.map((token) => token.used_at)).toEqual([null]);
    });

    it("never leaves two valid links when requests are simultaneous", async () => {
      const { email, userId } = await createAccount("r5-race");
      const send = () => request(app.getHttpServer()).post(RESEND_PATH).send({ email });
      const responses = await Promise.all([send(), send()]);

      expect(responses.map((response) => response.status)).toEqual([202, 202]);

      const tokens = await confirmationTokens(userId);

      expect(tokens).toHaveLength(3);
      expect(tokens.filter((token) => token.used_at === null)).toHaveLength(1);
    });

    it.each([
      ["a missing e-mail", {}],
      ["a malformed e-mail", { email: "ana-at-example" }],
      ["a non-text e-mail", { email: 7 }],
      ["an e-mail over 254 characters", { email: `${"a".repeat(250)}@example.test` }],
      ["an extra field", { email: "ana@example.test", isAdmin: true }],
    ])("rejects %s with 400 VALIDATION_FAILED", async (_label, body) => {
      const response = await request(app.getHttpServer()).post(RESEND_PATH).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    describe("when the mail provider is down", () => {
      let failingApp: INestApplication;

      beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(EMAIL_PROVIDER)
          .useValue({
            name: "failing",
            deliver: () => Promise.reject(new EmailDeliveryError("PROVIDER_UNAVAILABLE", false)),
          })
          .compile();

        failingApp = moduleRef.createNestApplication();
        configureApp(failingApp);
        await failingApp.init();
      });

      afterAll(async () => {
        await failingApp.close();
      });

      it("still answers 202 {} and logs the failure without PII", async () => {
        resetRateLimitStore(failingApp);

        const { email, userId } = await createAccount("r5-down");
        const error = vi.spyOn(baseLogger, "error");
        const response = await request(failingApp.getHttpServer())
          .post(RESEND_PATH)
          .send({ email });

        await failingApp.get(EmailService).drain();

        expect(response.status).toBe(202);
        expect(response.text).toBe("{}");
        expect(await confirmationTokens(userId)).toHaveLength(2);
        expect(error).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "email_delivery_failed",
            errorCode: "PROVIDER_UNAVAILABLE",
          }),
          "email_delivery_failed",
        );
        expect(JSON.stringify(error.mock.calls)).not.toContain(email);
      });
    });
  });

  describe("R6: rate limit", () => {
    it("answers 429 RATE_LIMITED on the 11th confirm-account request of the same IP", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await http.post(CONFIRM_PATH).send({ token: newToken() })).status).toBe(400);
      }

      const blocked = await http.post(CONFIRM_PATH).send({ token: newToken() });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    });

    it("answers 429 RATE_LIMITED on the 4th resend for the same IP and e-mail, and creates nothing for it", async () => {
      const { email, userId } = await createAccount("r6-resend");
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await http.post(RESEND_PATH).send({ email })).status).toBe(202);
      }

      const blocked = await http.post(RESEND_PATH).send({ email: email.toUpperCase() });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(await confirmationTokens(userId)).toHaveLength(4);
    });

    it("counts each e-mail separately for the same IP", async () => {
      const http = request(app.getHttpServer());

      for (const email of [newEmail("r6-a"), newEmail("r6-b")]) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          expect((await http.post(RESEND_PATH).send({ email })).status).toBe(202);
        }
      }
    });
  });

  describe("the auth functions", () => {
    it("returns the user id for a valid token and null otherwise; never overwrites a confirmation date", async () => {
      const { token, userId } = await createAccount("rpc-confirm");

      const done = await confirmAccount(sha256(token));
      const again = await confirmAccount(sha256(token));
      const unknown = await confirmAccount(sha256("nope"));

      expect(done).toBe(userId);
      expect(again).toBeNull();
      expect(unknown).toBeNull();

      const confirmedAt = (await userRow(userId)).email_confirmed_at;
      const other = await addToken(userId, "email_confirmation");

      expect(await confirmAccount(sha256(other))).toBe(userId);
      expect((await userRow(userId)).email_confirmed_at).toEqual(confirmedAt);
    });

    it("returns the first name for an unconfirmed account and null otherwise", async () => {
      const unconfirmed = await createAccount("rpc-resend", "Dora");
      const confirmed = await createAccount("rpc-resend-confirmed");

      await confirmAccount(sha256(confirmed.token));

      const resend = (email: string) =>
        resendConfirmation(email, sha256(randomUUID()), new Date(Date.now() + HOUR_MS));

      expect(await resend(unconfirmed.email)).toBe("Dora");
      expect(await resend(confirmed.email)).toBeNull();
      expect(await resend(newEmail("rpc-x"))).toBeNull();
      expect(await confirmationTokens(confirmed.userId)).toHaveLength(1);
    });
  });
});
