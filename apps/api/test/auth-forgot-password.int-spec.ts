import { createHash, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import {
  assertMigrationsApplied,
  createAdminClient,
  deleteUsersByEmail,
  restRequest,
  signRoleToken,
  uniqueEmail,
} from "./support/supabase";

const PATH = "/api/v1/auth/forgot-password";
const HOUR_MS = 60 * 60 * 1000;
const HEADERS_THAT_MAY_DIFFER = new Set(["date", "x-request-id"]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tokenHash(): string {
  return `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
}

describe("POST /api/v1/auth/forgot-password", () => {
  const admin: SupabaseClient = createAdminClient();
  const createdEmails: string[] = [];
  let app: INestApplication;

  function newEmail(label: string): string {
    const email = uniqueEmail(label);

    createdEmails.push(email);
    return email;
  }

  /** Creates an account through the sign-up function; `confirmed` sets `email_confirmed_at`. */
  async function createAccount(label: string, confirmed: boolean, firstName = "Ana") {
    const email = newEmail(label);
    const { data: userId, error } = await admin.rpc("auth_sign_up", {
      p_first_name: firstName,
      p_last_name: "Silva",
      p_email: email,
      p_password_hash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
      p_token_hash: tokenHash(),
      p_token_expires_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
    });

    expect(error).toBeNull();

    if (confirmed) {
      await admin
        .from("users")
        .update({ email_confirmed_at: new Date().toISOString() })
        .eq("id", userId);
    }

    return { email, userId: userId as string };
  }

  async function resetTokens(userId: string) {
    const { data } = await admin
      .from("auth_tokens")
      .select("*")
      .eq("user_id", userId)
      .eq("type", "password_reset")
      .order("created_at", { ascending: true });

    return data ?? [];
  }

  async function allTokens(userId: string) {
    const { data } = await admin.from("auth_tokens").select("*").eq("user_id", userId);

    return data ?? [];
  }

  beforeAll(async () => {
    await assertMigrationsApplied(admin);

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

  describe("R1: identical generic answer", () => {
    it("answers 202 {} with the same headers and bytes for confirmed, unconfirmed and unknown e-mails", async () => {
      const confirmed = await createAccount("r1-confirmed", true);
      const unconfirmed = await createAccount("r1-unconfirmed", false);
      const unknown = newEmail("r1-unknown");
      const http = request(app.getHttpServer());

      const responses: request.Response[] = [];

      for (const email of [confirmed.email, unconfirmed.email, unknown]) {
        responses.push(await http.post(PATH).send({ email }));
      }

      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(response.body).toEqual({});
      }

      const comparable = (response: request.Response) =>
        JSON.stringify(
          Object.entries(response.headers)
            .filter(([name]) => !HEADERS_THAT_MAY_DIFFER.has(name))
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

    it("accepts the e-mail in another case and with spaces", async () => {
      const { email, userId } = await createAccount("r1-case", true);
      const response = await request(app.getHttpServer())
        .post(PATH)
        .send({ email: `  ${email.toUpperCase()} ` });

      expect(response.status).toBe(202);
      expect(await resetTokens(userId)).toHaveLength(1);
    });

    it.each([
      ["a missing e-mail", {}],
      ["a malformed e-mail", { email: "ana-at-example" }],
      ["a non-text e-mail", { email: 7 }],
      ["an e-mail over 254 characters", { email: `${"a".repeat(250)}@example.test` }],
      ["an extra field", { email: "ana@example.test", isAdmin: true }],
    ])("rejects %s with 400 VALIDATION_FAILED", async (_label, body) => {
      const response = await request(app.getHttpServer()).post(PATH).send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("reports the e-mail as the failing field", async () => {
      const response = await request(app.getHttpServer()).post(PATH).send({ email: "nope" });

      expect(response.body.error.details).toEqual([
        { field: "email", message: "Enter a valid email address." },
      ]);
    });
  });

  describe("R2: confirmed account gets a token and an e-mail", () => {
    it("stores only the hash of a 1 hour token and mails a link that hashes to it", async () => {
      const { email, userId } = await createAccount("r2", true, "Bianca");
      const before = Date.now();
      const response = await request(app.getHttpServer()).post(PATH).send({ email });

      expect(response.status).toBe(202);
      await app.get(EmailService).drain();

      const messages = getCapturedEmails({ to: email });

      expect(messages).toHaveLength(1);

      const [message] = messages;
      const appUrl = process.env.APP_URL as string;
      const pattern = new RegExp(`${appUrl}/auth/reset-password\\?token=([A-Za-z0-9_-]+)`);
      const token = pattern.exec(message?.text ?? "")?.[1];

      expect(token).toBeDefined();
      expect(message?.subject).toBe("Reset your Rondo password");
      expect(message?.text).toContain("Hi Bianca,");
      expect(message?.text).toContain("1 hour");
      expect(message?.text).toContain("If you didn't request this, you can ignore this email");
      expect(message?.html).toContain(`${appUrl}/auth/reset-password?token=${token}`);

      const tokens = await resetTokens(userId);

      expect(tokens).toHaveLength(1);

      const stored = tokens[0];
      const expiresIn = new Date(stored?.expires_at).getTime() - before;

      expect(stored?.token_hash).toBe(sha256(token as string));
      expect(JSON.stringify(stored)).not.toContain(token as string);
      expect(stored).toMatchObject({ type: "password_reset", used_at: null });
      expect(expiresIn).toBeGreaterThan(HOUR_MS - 60_000);
      expect(expiresIn).toBeLessThan(HOUR_MS + 60_000);
    });

    it("leaves the confirmation token of the account untouched", async () => {
      const { email, userId } = await createAccount("r2-confirmation", true);

      await request(app.getHttpServer()).post(PATH).send({ email });

      const confirmation = (await allTokens(userId)).filter(
        (token) => token.type === "email_confirmation",
      );

      expect(confirmation).toHaveLength(1);
      expect(confirmation[0]?.used_at).toBeNull();
    });
  });

  describe("R3: unknown or unconfirmed accounts get nothing", () => {
    it("creates no token and sends no e-mail for an unconfirmed account", async () => {
      const { email, userId } = await createAccount("r3-unconfirmed", false);
      const response = await request(app.getHttpServer()).post(PATH).send({ email });

      expect(response.status).toBe(202);
      await app.get(EmailService).drain();

      expect(await resetTokens(userId)).toEqual([]);
      expect(getCapturedEmails({ to: email })).toEqual([]);
    });

    it("creates no token and sends no e-mail for an unknown e-mail", async () => {
      const email = newEmail("r3-unknown");
      const response = await request(app.getHttpServer()).post(PATH).send({ email });

      expect(response.status).toBe(202);
      await app.get(EmailService).drain();

      expect(getCapturedEmails({ to: email })).toEqual([]);
    });
  });

  describe("R4: a new request invalidates the previous one", () => {
    it("marks the earlier token as used and leaves only the newest usable", async () => {
      const { email, userId } = await createAccount("r4", true);
      const http = request(app.getHttpServer());

      expect((await http.post(PATH).send({ email })).status).toBe(202);
      expect((await http.post(PATH).send({ email })).status).toBe(202);

      const tokens = await resetTokens(userId);

      expect(tokens).toHaveLength(2);
      expect(tokens[0]?.used_at).not.toBeNull();
      expect(tokens[1]?.used_at).toBeNull();

      await app.get(EmailService).drain();

      const [first, second] = getCapturedEmails({ to: email });
      const hashOf = (text: string | undefined) =>
        sha256(/token=([A-Za-z0-9_-]+)/.exec(text ?? "")?.[1] ?? "");

      expect(tokens[0]?.token_hash).toBe(hashOf(first?.text));
      expect(tokens[1]?.token_hash).toBe(hashOf(second?.text));
    });

    it("never leaves two valid tokens when requests are simultaneous", async () => {
      const { email, userId } = await createAccount("r4-race", true);
      const send = () => request(app.getHttpServer()).post(PATH).send({ email });
      const responses = await Promise.all([send(), send()]);

      expect(responses.map((response) => response.status)).toEqual([202, 202]);

      const tokens = await resetTokens(userId);

      expect(tokens).toHaveLength(2);
      expect(tokens.filter((token) => token.used_at === null)).toHaveLength(1);
    });
  });

  describe("R5: mail provider down", () => {
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

    it("still answers 202 {} like the normal case and logs the failure without PII", async () => {
      resetRateLimitStore(failingApp);

      const { email, userId } = await createAccount("r5", true);
      const error = vi.spyOn(baseLogger, "error");
      const response = await request(failingApp.getHttpServer()).post(PATH).send({ email });

      await failingApp.get(EmailService).drain();

      expect(response.status).toBe(202);
      expect(response.text).toBe("{}");
      expect(await resetTokens(userId)).toHaveLength(1);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "email_delivery_failed",
          errorCode: "PROVIDER_UNAVAILABLE",
        }),
        "email_delivery_failed",
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain(email);
    });

    it("does not wait for the provider before answering", async () => {
      resetRateLimitStore(failingApp);

      const { email } = await createAccount("r5-timing", true);
      const slowApp = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EMAIL_PROVIDER)
        .useValue({
          name: "slow",
          deliver: () => new Promise((resolve) => setTimeout(resolve, 1_500)),
        })
        .compile();
      const slow = slowApp.createNestApplication();

      configureApp(slow);
      await slow.init();

      try {
        const startedAt = Date.now();
        const response = await request(slow.getHttpServer()).post(PATH).send({ email });

        expect(response.status).toBe(202);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        await slow.get(EmailService).drain();
      } finally {
        await slow.close();
      }
    });
  });

  describe("R6: rate limit", () => {
    it("answers 429 RATE_LIMITED on the 4th request of the same IP and e-mail, and creates nothing for it", async () => {
      const { email, userId } = await createAccount("r6", true);
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await http.post(PATH).send({ email })).status).toBe(202);
      }

      const blocked = await http.post(PATH).send({ email: email.toUpperCase() });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(await resetTokens(userId)).toHaveLength(3);
    });

    it("counts each e-mail separately for the same IP", async () => {
      const http = request(app.getHttpServer());
      const emails = [newEmail("r6-a"), newEmail("r6-b")];

      for (const email of emails) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          expect((await http.post(PATH).send({ email })).status).toBe(202);
        }
      }
    });
  });

  describe("auth_request_password_reset permissions", () => {
    const params = (email: string) => ({
      p_email: email,
      p_token_hash: tokenHash(),
      p_token_expires_at: new Date(Date.now() + HOUR_MS).toISOString(),
    });

    it.each(["anon", "authenticated"] as const)(
      "cannot be called through PostgREST as the %s role",
      async (role) => {
        const { email, userId } = await createAccount(`rpc-${role}`, true);
        const response = await restRequest("rpc/auth_request_password_reset", signRoleToken(role), {
          method: "POST",
          body: JSON.stringify(params(email)),
        });

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(await resetTokens(userId)).toEqual([]);
      },
    );

    it("returns the first name for a confirmed account and null otherwise", async () => {
      const confirmed = await createAccount("rpc-confirmed", true, "Carla");
      const unconfirmed = await createAccount("rpc-unconfirmed", false);

      const done = await admin.rpc("auth_request_password_reset", params(confirmed.email));
      const skipped = await admin.rpc("auth_request_password_reset", params(unconfirmed.email));
      const unknown = await admin.rpc("auth_request_password_reset", params(newEmail("rpc-x")));

      expect(done.data).toBe("Carla");
      expect(skipped.data).toBeNull();
      expect(unknown.data).toBeNull();
      expect(await resetTokens(unconfirmed.userId)).toEqual([]);
    });
  });
});
