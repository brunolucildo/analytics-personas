import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  restRequest,
  signRoleToken,
  uniqueEmail,
} from "./support/supabase";

const RESET_PATH = "/api/v1/auth/reset-password";
const SIGN_IN_PATH = "/api/v1/auth/sign-in";
const SESSION_PATH = "/api/v1/auth/session";
const OLD_PASSWORD = "the old password";
const NEW_PASSWORD = "a brand new password";
const HOUR_MS = 60 * 60 * 1000;
const SUBJECT = "Your Analytics Personas password was changed";
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

describe("POST /api/v1/auth/reset-password", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];
  let app: INestApplication;
  let oldPasswordHash: string;

  /** Inserts a confirmed account with a real Argon2id hash of `OLD_PASSWORD`. */
  async function createAccount(label: string, firstName = "Ana") {
    const email = uniqueEmail(label);

    createdEmails.push(email);

    const { data, error } = await admin
      .from("users")
      .insert({
        first_name: firstName,
        last_name: "Silva",
        email,
        password_hash: oldPasswordHash,
        email_confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    expect(error).toBeNull();

    return { email, userId: data?.id as string };
  }

  /** Stores a token (any type, any expiry) for the user and returns the raw value of the link. */
  async function addToken(
    userId: string,
    type: "email_confirmation" | "password_reset" = "password_reset",
    expiresInMs = HOUR_MS,
    usedAt: string | null = null,
  ) {
    const token = newToken();
    const { error } = await admin.from("auth_tokens").insert({
      user_id: userId,
      type,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      used_at: usedAt,
    });

    expect(error).toBeNull();

    return token;
  }

  async function passwordHashOf(userId: string): Promise<string> {
    const { data } = await admin.from("users").select("password_hash").eq("id", userId).single();

    return (data as { password_hash: string }).password_hash;
  }

  async function tokensOf(userId: string, type = "password_reset") {
    const { data } = await admin
      .from("auth_tokens")
      .select("*")
      .eq("user_id", userId)
      .eq("type", type)
      .order("token_hash");

    return data ?? [];
  }

  async function snapshot(userId: string) {
    const { data: tokens } = await admin
      .from("auth_tokens")
      .select("*")
      .eq("user_id", userId)
      .order("token_hash");

    return JSON.stringify({
      hash: await passwordHashOf(userId),
      tokens,
      sessions: await sessionsOf(admin, userId),
    });
  }

  const activeSessions = async (userId: string) =>
    (await sessionsOf(admin, userId)).filter((session) => session.revoked_at === null);

  const reset = (body: Record<string, unknown>, server: INestApplication = app): request.Test =>
    request(server.getHttpServer()).post(RESET_PATH).send(body);

  const resetWith = (token: string, password = NEW_PASSWORD) =>
    reset({ token, password, confirmPassword: password });

  const signIn = (email: string, password: string) =>
    request(app.getHttpServer()).post(SIGN_IN_PATH).send({ email, password });

  beforeAll(async () => {
    await assertMigrationsApplied(admin);
    oldPasswordHash = await argon2.hash(OLD_PASSWORD, { type: argon2.argon2id });

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

  describe("R1: a valid token changes the password", () => {
    it("answers 204 with no body, stores a new Argon2id hash and uses the token and its siblings", async () => {
      const { userId } = await createAccount("r1");
      const token = await addToken(userId);
      const sibling = await addToken(userId);
      const confirmation = await addToken(userId, "email_confirmation", 24 * HOUR_MS);
      const response = await resetWith(token);

      expect(response.status).toBe(204);
      expect(response.text).toBe("");

      const stored = await passwordHashOf(userId);

      expect(stored).toMatch(/^\$argon2id\$/);
      expect(stored).not.toBe(oldPasswordHash);
      expect(await argon2.verify(stored, NEW_PASSWORD)).toBe(true);

      const resetTokens = await tokensOf(userId);

      expect(resetTokens).toHaveLength(2);
      expect(resetTokens.every((row) => row.used_at !== null)).toBe(true);

      // The other kind of token is not touched.
      const [confirmationRow] = await tokensOf(userId, "email_confirmation");

      expect(confirmationRow?.token_hash).toBe(sha256(confirmation));
      expect(confirmationRow?.used_at).toBeNull();

      // The sibling link no longer works.
      expect((await resetWith(sibling, "yet another password")).status).toBe(400);
    });

    it("makes the new password work on sign-in and the old one stop working", async () => {
      const { email, userId } = await createAccount("r1-sign-in");

      expect((await signIn(email, OLD_PASSWORD)).status).toBe(200);

      await resetWith(await addToken(userId));

      expect((await signIn(email, OLD_PASSWORD)).status).toBe(401);
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
    });

    it("does not open a session", async () => {
      const { userId } = await createAccount("r1-no-session");

      await resetWith(await addToken(userId));

      expect(await sessionsOf(admin, userId)).toEqual([]);
    });

    it("does not change the confirmation of the account", async () => {
      const { userId } = await createAccount("r1-confirmed");
      const before = await admin.from("users").select("email_confirmed_at").eq("id", userId);

      await resetWith(await addToken(userId));

      const after = await admin.from("users").select("email_confirmed_at").eq("id", userId);

      expect(after.data).toEqual(before.data);
    });
  });

  describe("R2: validation happens before the token is used", () => {
    it.each([
      ["a short password", { password: "1234567", confirmPassword: "1234567" }, "password"],
      [
        "a password over 128 characters",
        { password: "x".repeat(129), confirmPassword: "x".repeat(129) },
        "password",
      ],
      [
        "a different confirmation",
        { password: NEW_PASSWORD, confirmPassword: "something else 1" },
        "confirmPassword",
      ],
      ["a missing password", { confirmPassword: NEW_PASSWORD }, "password"],
      ["a missing confirmation", { password: NEW_PASSWORD }, "confirmPassword"],
    ])(
      "answers 400 VALIDATION_FAILED for %s and keeps the token usable",
      async (_label, fields, field) => {
        const { userId } = await createAccount("r2");
        const token = await addToken(userId);
        const before = await snapshot(userId);
        const response = await reset({ token, ...fields });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("VALIDATION_FAILED");
        expect(response.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })]),
        );
        expect(await snapshot(userId)).toBe(before);
        expect(getCapturedEmails({})).toEqual([]);

        // The very same link still works afterwards.
        expect((await resetWith(token)).status).toBe(204);
      },
    );

    it("tells a mismatch with the agreed message", async () => {
      const response = await reset({
        token: "whatever",
        password: NEW_PASSWORD,
        confirmPassword: "something else 1",
      });

      expect(response.body.error.details).toEqual([
        expect.objectContaining({ field: "confirmPassword", message: "Passwords do not match" }),
      ]);
    });

    it.each([
      ["a missing token", { password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }],
      ["an empty token", { token: "", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }],
      [
        "an extra field",
        { token: "abc", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD, isAdmin: true },
      ],
    ])("answers 400 VALIDATION_FAILED for %s", async (_label, body) => {
      const response = await reset(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("R3: one answer for every bad token", () => {
    it("answers 400 TOKEN_INVALID_OR_EXPIRED, identical for unknown, expired, used and wrong-type tokens, and changes nothing", async () => {
      const { userId } = await createAccount("r3");
      const bad = {
        unknown: newToken(),
        expired: await addToken(userId, "password_reset", -1_000),
        used: await addToken(userId, "password_reset", HOUR_MS, new Date().toISOString()),
        wrongType: await addToken(userId, "email_confirmation", 24 * HOUR_MS),
      };
      const before = await snapshot(userId);
      const responses = [];

      for (const token of Object.values(bad)) {
        responses.push(await resetWith(token));
      }

      for (const response of responses) {
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: { ...INVALID_BODY.error, details: [] } });
      }

      expect(new Set(responses.map((response) => response.text)).size).toBe(1);
      expect(await snapshot(userId)).toBe(before);
      expect(getCapturedEmails({})).toEqual([]);
    });
  });

  describe("R4: a token works once, even under concurrency", () => {
    it("lets exactly one of two simultaneous requests win, and the winner's password stands", async () => {
      const { userId } = await createAccount("r4");
      const token = await addToken(userId);
      const responses = await Promise.all([
        resetWith(token, "password from request A"),
        resetWith(token, "password from request B"),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([204, 400]);

      const winner =
        responses[0]?.status === 204 ? "password from request A" : "password from request B";
      const loser =
        winner === "password from request A"
          ? "password from request B"
          : "password from request A";
      const stored = await passwordHashOf(userId);

      expect(await argon2.verify(stored, winner)).toBe(true);
      expect(await argon2.verify(stored, loser)).toBe(false);
    });

    it("refuses the same link a second time", async () => {
      const { userId } = await createAccount("r4-twice");
      const token = await addToken(userId);

      expect((await resetWith(token)).status).toBe(204);

      const second = await resetWith(token, "another password 1");

      expect(second.status).toBe(400);
      expect(second.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
      expect(await argon2.verify(await passwordHashOf(userId), NEW_PASSWORD)).toBe(true);
    });
  });

  describe("R5: every session of the user is revoked", () => {
    it("answers 401 to the old session token and leaves no active session", async () => {
      const { email, userId } = await createAccount("r5");
      const session = await signIn(email, OLD_PASSWORD);

      expect(session.status).toBe(200);
      expect(
        (await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(session.body.accessToken)))
          .status,
      ).toBe(200);

      await resetWith(await addToken(userId));

      const after = await request(app.getHttpServer())
        .get(SESSION_PATH)
        .set(bearer(session.body.accessToken));

      expect(after.status).toBe(401);
      expect(await activeSessions(userId)).toEqual([]);
      expect((await sessionsOf(admin, userId))[0]?.revoked_at).not.toBeNull();
    });

    it("does not touch the sessions of other users", async () => {
      const { userId } = await createAccount("r5-target");
      const other = await createAccount("r5-other");
      const otherSession = await signIn(other.email, OLD_PASSWORD);

      await resetWith(await addToken(userId));

      expect(
        (
          await request(app.getHttpServer())
            .get(SESSION_PATH)
            .set(bearer(otherSession.body.accessToken))
        ).status,
      ).toBe(200);
      expect(await activeSessions(other.userId)).toHaveLength(1);
    });

    it("does not revoke the session when the token is refused", async () => {
      const { email, userId } = await createAccount("r5-refused");
      const session = await signIn(email, OLD_PASSWORD);

      expect((await resetWith(newToken())).status).toBe(400);
      expect(await activeSessions(userId)).toHaveLength(1);
      expect(
        (await request(app.getHttpServer()).get(SESSION_PATH).set(bearer(session.body.accessToken)))
          .status,
      ).toBe(200);
    });
  });

  describe("R6: success e-mail", () => {
    it("delivers a message in English to the account with the first name, the UTC time and the forgot-password link", async () => {
      const { email, userId } = await createAccount("r6", "Bianca");
      const before = Date.now();

      expect((await resetWith(await addToken(userId))).status).toBe(204);
      await app.get(EmailService).drain();

      const messages = getCapturedEmails({ to: email });

      expect(messages).toHaveLength(1);

      const [message] = messages;

      expect(message?.subject).toBe(SUBJECT);
      expect(message?.text).toContain("Hi Bianca,");
      expect(message?.text).toMatch(/changed on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
      expect(message?.text).toContain("If you didn't do this, reset your password again");
      expect(message?.text).toMatch(/http\S*\/auth\/forgot-password/);
      expect(Date.now() - before).toBeLessThan(60_000);
    });

    it("carries no password, token, IP or reset link", async () => {
      const { email, userId } = await createAccount("r6-clean");
      const token = await addToken(userId);

      await resetWith(token);
      await app.get(EmailService).drain();

      const [message] = getCapturedEmails({ to: email });
      const content = `${message?.text}\n${message?.html}`;

      expect(content).not.toContain(token);
      expect(content).not.toContain(NEW_PASSWORD);
      expect(content).not.toContain("/auth/reset-password");
      expect(content).not.toMatch(/\bIP\b/);
    });

    it("sends nothing for a refused reset (validation or bad token)", async () => {
      const { email, userId } = await createAccount("r6-refused");
      const token = await addToken(userId);

      await reset({ token, password: "short", confirmPassword: "short" });
      await resetWith(newToken());
      await app.get(EmailService).drain();

      expect(getCapturedEmails({ to: email })).toEqual([]);
    });

    describe("when the provider is down", () => {
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

      it("still answers 204, changes the password and logs the failure without PII", async () => {
        resetRateLimitStore(failingApp);

        const { email, userId } = await createAccount("r6-down");
        const token = await addToken(userId);
        const error = vi.spyOn(baseLogger, "error");
        const response = await reset(
          { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
          failingApp,
        );

        await failingApp.get(EmailService).drain();

        expect(response.status).toBe(204);
        expect(await argon2.verify(await passwordHashOf(userId), NEW_PASSWORD)).toBe(true);
        expect(error).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "email_delivery_failed",
            errorCode: "PROVIDER_UNAVAILABLE",
          }),
          "email_delivery_failed",
        );

        const logged = JSON.stringify(error.mock.calls);

        expect(logged).not.toContain(email);
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(NEW_PASSWORD);
      });
    });
  });

  describe("R7: rate limit", () => {
    it("answers 429 RATE_LIMITED on the 11th request of the same IP and does nothing for it", async () => {
      const { userId } = await createAccount("r7");
      const token = await addToken(userId);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await resetWith(newToken())).status).toBe(400);
      }

      const blocked = await resetWith(token);

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(await argon2.verify(await passwordHashOf(userId), OLD_PASSWORD)).toBe(true);
      expect((await tokensOf(userId))[0]?.used_at).toBeNull();
    });
  });

  describe("route is public", () => {
    it("needs no bearer token", async () => {
      const response = await reset({
        token: newToken(),
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("TOKEN_INVALID_OR_EXPIRED");
    });
  });

  describe("auth_reset_password", () => {
    const params = (tokenHash: string) => ({ p_token_hash: tokenHash, p_password_hash: "x" });

    it.each(["anon", "authenticated"] as const)(
      "cannot be called through PostgREST as the %s role",
      async (role) => {
        const { userId } = await createAccount(`rpc-${role}`);
        const token = await addToken(userId);
        const response = await restRequest("rpc/auth_reset_password", signRoleToken(role), {
          method: "POST",
          body: JSON.stringify(params(sha256(token))),
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect((await tokensOf(userId))[0]?.used_at).toBeNull();
        expect(await passwordHashOf(userId)).toBe(oldPasswordHash);
      },
    );

    it("returns the owner for a valid token and no row otherwise", async () => {
      const { email, userId } = await createAccount("rpc-owner", "Carla");
      const token = await addToken(userId);
      const done = await admin.rpc("auth_reset_password", {
        p_token_hash: sha256(token),
        p_password_hash: "$argon2id$replaced",
      });
      const again = await admin.rpc("auth_reset_password", {
        p_token_hash: sha256(token),
        p_password_hash: "$argon2id$replaced-again",
      });
      const unknown = await admin.rpc("auth_reset_password", params(sha256(randomUUID())));

      expect(done.data).toEqual([{ user_id: userId, first_name: "Carla", email }]);
      expect(again.data).toEqual([]);
      expect(unknown.data).toEqual([]);
      expect(await passwordHashOf(userId)).toBe("$argon2id$replaced");
    });
  });
});
