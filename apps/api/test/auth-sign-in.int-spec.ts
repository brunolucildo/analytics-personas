import type { INestApplication } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Test } from "@nestjs/testing";
import argon2 from "argon2";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import {
  clearCapturedEmails,
  EmailDeliveryError,
  EmailService,
  getCapturedEmails,
} from "../src/modules/email";
import { EMAIL_PROVIDER } from "../src/modules/email/email.tokens";
import { baseLogger } from "../src/observability/logger";
import { resetRateLimitStore } from "./support/rate-limit";
import { sessionsOf } from "./support/sessions";
import {
  assertMigrationsApplied,
  createAdminClient,
  deleteUsersByEmail,
  uniqueEmail,
} from "./support/supabase";

const PATH = "/api/v1/auth/sign-in";
const SESSION_PATH = "/api/v1/auth/session";
const PASSWORD = "correct horse battery";
const HEADERS_THAT_MAY_DIFFER = new Set(["date", "x-request-id", "etag"]);

describe("POST /api/v1/auth/sign-in", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];
  let app: INestApplication;
  let passwordHash: string;

  /** Inserts an account with a real Argon2id hash of `PASSWORD`. */
  async function createAccount(label: string, confirmed: boolean, firstName = "Ana") {
    const email = uniqueEmail(label);

    createdEmails.push(email);

    const { data, error } = await admin
      .from("users")
      .insert({
        first_name: firstName,
        last_name: "Silva",
        email,
        password_hash: passwordHash,
        email_confirmed_at: confirmed ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    expect(error).toBeNull();

    return { email, userId: data?.id as string };
  }

  const signIn = (email: string, password = PASSWORD, server: INestApplication = app) =>
    request(server.getHttpServer()).post(PATH).send({ email, password });

  const activeSessions = async (userId: string) =>
    (await sessionsOf(admin, userId)).filter((session) => session.revoked_at === null);

  const comparable = (response: request.Response) =>
    JSON.stringify(
      Object.entries(response.headers)
        .filter(([name]) => !HEADERS_THAT_MAY_DIFFER.has(name))
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  beforeAll(async () => {
    await assertMigrationsApplied(admin);
    passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await deleteUsersByEmail(admin, createdEmails);
  });

  beforeEach(() => {
    resetRateLimitStore(app);
  });

  afterEach(() => {
    clearCapturedEmails();
    vi.restoreAllMocks();
  });

  describe("R1: valid credentials open the session", () => {
    it("answers 200 with the session response and one active session", async () => {
      const { email, userId } = await createAccount("r1", true, "Bianca");
      const before = Date.now();
      const response = await signIn(email);

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(["accessToken", "expiresAt", "user"]);
      expect(response.body.user).toEqual({
        id: userId,
        firstName: "Bianca",
        lastName: "Silva",
        email,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/argon2|password/i);

      const expiresIn = new Date(response.body.expiresAt).getTime() - before;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      expect(expiresIn).toBeGreaterThan(sevenDaysMs - 60_000);
      expect(expiresIn).toBeLessThan(sevenDaysMs + 60_000);
      expect(await activeSessions(userId)).toHaveLength(1);

      const me = await request(app.getHttpServer())
        .get(SESSION_PATH)
        .set("authorization", `Bearer ${response.body.accessToken}`);

      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(userId);
    });

    it("accepts the e-mail in another case and with spaces", async () => {
      const { email, userId } = await createAccount("r1-case", true);
      const response = await signIn(`  ${email.toUpperCase()} `);

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBe(email);
      expect(await activeSessions(userId)).toHaveLength(1);
    });

    it("does not trim or change the password", async () => {
      const { email } = await createAccount("r1-password", true);

      expect((await signIn(email, ` ${PASSWORD} `)).status).toBe(401);
      expect((await signIn(email, PASSWORD.toUpperCase())).status).toBe(401);
    });
  });

  describe("R2: one answer for every bad credential", () => {
    it("answers 401 INVALID_CREDENTIALS with identical status, headers and body for an unknown e-mail and a wrong password", async () => {
      const { email, userId } = await createAccount("r2", true);
      const unknown = await signIn(uniqueEmail("r2-unknown"), "some other password");
      const wrong = await signIn(email, "some other password");

      for (const response of [unknown, wrong]) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password.",
            details: [],
          },
        });
      }

      expect(wrong.text).toBe(unknown.text);
      expect(comparable(wrong)).toBe(comparable(unknown));
      expect(await sessionsOf(admin, userId)).toEqual([]);
    });

    it("also verifies a hash for an unknown e-mail (comparable work, so comparable time)", async () => {
      const { email } = await createAccount("r2-timing", true);
      const timeOf = async (target: string) => {
        const startedAt = performance.now();

        await signIn(target, "some other password");

        return performance.now() - startedAt;
      };

      // Warm up (phantom hash, connections), then compare medians of a few runs.
      await timeOf(uniqueEmail("r2-warm"));

      const median = (values: number[]) => [...values].sort((a, b) => a - b)[2] as number;
      const known: number[] = [];
      const unknown: number[] = [];

      for (let run = 0; run < 5; run += 1) {
        known.push(await timeOf(email));
        unknown.push(await timeOf(uniqueEmail("r2-unknown")));
      }

      // Without the phantom check an unknown e-mail would answer in a few ms, far below a real hash check.
      expect(median(unknown)).toBeGreaterThan(median(known) / 3);
    });

    it.each([
      ["a missing e-mail", { password: PASSWORD }],
      ["a missing password", { email: "ana@example.test" }],
      ["a malformed e-mail", { email: "ana-at-example", password: PASSWORD }],
      ["an empty password", { email: "ana@example.test", password: "" }],
      ["a non-text password", { email: "ana@example.test", password: 12345678 }],
      ["an extra field", { email: "ana@example.test", password: PASSWORD, isAdmin: true }],
    ])("rejects %s with 400 VALIDATION_FAILED", async (_label, body) => {
      const response = await request(app.getHttpServer()).post(PATH).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("treats a short password as a wrong password, not as a validation error", async () => {
      const { email } = await createAccount("r2-short", true);

      expect((await signIn(email, "abc")).status).toBe(401);
    });
  });

  describe("R3: an unconfirmed account is only revealed to the right password", () => {
    it("answers 403 EMAIL_NOT_CONFIRMED for the right password and opens no session", async () => {
      const { email, userId } = await createAccount("r3", false);
      const response = await signIn(email);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("EMAIL_NOT_CONFIRMED");
      expect(await sessionsOf(admin, userId)).toEqual([]);

      await app.get(EmailService).drain();
      expect(getCapturedEmails({ to: email })).toEqual([]);
    });

    it("answers the generic 401 for a wrong password, like any other account", async () => {
      const { email } = await createAccount("r3-wrong", false);
      const unconfirmed = await signIn(email, "some other password");
      const unknown = await signIn(uniqueEmail("r3-unknown"), "some other password");

      expect(unconfirmed.status).toBe(401);
      expect(unconfirmed.text).toBe(unknown.text);
    });
  });

  describe("R4: one session per user", () => {
    it("rejects the first token and accepts the second after two sign-ins", async () => {
      const { email, userId } = await createAccount("r4", true);
      const first = await signIn(email);
      const second = await signIn(email);
      const check = (token: string) =>
        request(app.getHttpServer()).get(SESSION_PATH).set("authorization", `Bearer ${token}`);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const withFirst = await check(first.body.accessToken);

      expect(withFirst.status).toBe(401);
      expect(withFirst.body.error.code).toBe("UNAUTHENTICATED");
      expect((await check(second.body.accessToken)).status).toBe(200);
      expect(await activeSessions(userId)).toHaveLength(1);
    });
  });

  describe("R5: new sign-in e-mail", () => {
    it("delivers the notice for a successful sign-in, without IP, device, token or password", async () => {
      const { email } = await createAccount("r5", true, "Carla");
      const before = new Date();
      const response = await signIn(email);

      expect(response.status).toBe(200);
      await app.get(EmailService).drain();

      const messages = getCapturedEmails({ to: email });

      expect(messages).toHaveLength(1);

      const [message] = messages;
      const appUrl = process.env.APP_URL as string;
      const sentAt = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC/.exec(message?.text ?? "")?.[1];

      expect(message?.subject).toBe("New sign-in to Rondo");
      expect(message?.text).toContain("Hi Carla,");
      expect(message?.text).toContain("earlier session was signed out");
      expect(message?.text).toContain(
        `If this wasn't you, reset your password: ${appUrl}/auth/forgot-password`,
      );
      expect(message?.html).toContain(`href="${appUrl}/auth/forgot-password"`);
      expect(sentAt).toBeDefined();
      expect(Math.abs(Date.parse(`${sentAt}:00Z`) - before.getTime())).toBeLessThan(2 * 60_000);
      expect(message?.text).not.toContain(response.body.accessToken);
      expect(message?.text).not.toContain(PASSWORD);
      expect(message?.text).not.toMatch(/\bIP\b|device|browser|location/i);
    });

    it("sends one notice per sign-in", async () => {
      const { email } = await createAccount("r5-twice", true);

      await signIn(email);
      await signIn(email);
      await app.get(EmailService).drain();

      expect(getCapturedEmails({ to: email })).toHaveLength(2);
    });

    it("sends nothing for a failed sign-in", async () => {
      const { email } = await createAccount("r5-failed", true);

      await signIn(email, "some other password");
      await signIn(uniqueEmail("r5-unknown"));
      await app.get(EmailService).drain();

      expect(getCapturedEmails({ to: email })).toEqual([]);
      expect(getCapturedEmails()).toEqual([]);
    });
  });

  describe("R6: mail provider down", () => {
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

    it("still answers 200 with the session and logs the failure without PII", async () => {
      resetRateLimitStore(failingApp);

      const { email, userId } = await createAccount("r6", true);
      const error = vi.spyOn(baseLogger, "error");
      const response = await signIn(email, PASSWORD, failingApp);

      await failingApp.get(EmailService).drain();

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(await activeSessions(userId)).toHaveLength(1);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ event: "email_delivery_failed" }),
        "email_delivery_failed",
      );

      const logged = JSON.stringify(error.mock.calls);

      expect(logged).not.toContain(email);
      expect(logged).not.toContain(PASSWORD);
      expect(logged).not.toContain(response.body.accessToken);
    });
  });

  describe("R7: rate limit", () => {
    it("answers 429 RATE_LIMITED on the 11th attempt of the same IP and e-mail, and opens no session for it", async () => {
      const { email, userId } = await createAccount("r7", true);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await signIn(email, "some other password")).status).toBe(401);
      }

      const blocked = await signIn(email.toUpperCase());

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(await sessionsOf(admin, userId)).toEqual([]);
    });

    it("counts each e-mail separately for the same IP", async () => {
      const { email } = await createAccount("r7-a", true);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await signIn(email, "some other password");
      }

      expect((await signIn(email)).status).toBe(429);
      expect((await signIn(uniqueEmail("r7-b"))).status).toBe(401);
    });
  });
});
