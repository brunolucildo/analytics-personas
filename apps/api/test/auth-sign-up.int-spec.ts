import { createHash } from "node:crypto";
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
import {
  assertMigrationsApplied,
  deleteUsersByEmail,
  findUserByEmail,
  listTokensOfUser,
  listUsersByEmail,
  uniqueEmail,
} from "./support/database";

const PASSWORD = "correct horse battery";
const SIGN_UP_PATH = "/api/v1/auth/sign-up";

function validBody(email: string, overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Ana",
    lastName: "Silva",
    email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...overrides,
  };
}

describe("POST /api/v1/auth/sign-up", () => {
  const createdEmails: string[] = [];
  let app: INestApplication;

  function newEmail(label: string): string {
    const email = uniqueEmail(label);

    createdEmails.push(email);
    return email;
  }

  async function findUser(email: string) {
    return findUserByEmail(email);
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

  describe("R2: creates an unconfirmed user", () => {
    it("answers 201 with only the normalized e-mail and stores an Argon2id hash", async () => {
      const email = newEmail("ana-created");
      const typed = `  ${email.toUpperCase()} `;
      const response = await request(app.getHttpServer())
        .post(SIGN_UP_PATH)
        .send(validBody(typed, { firstName: "  Ana ", lastName: " Silva  " }));

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ email });

      const user = await findUser(email);

      expect(user).toMatchObject({
        first_name: "Ana",
        last_name: "Silva",
        email,
        email_confirmed_at: null,
      });
      expect(user?.password_hash.startsWith("$argon2id$")).toBe(true);
      expect(JSON.stringify(user)).not.toContain(PASSWORD);
      expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
    });
  });

  describe("R3: validation", () => {
    it.each([
      ["an empty first name", { firstName: "" }, "firstName"],
      ["a first name over 100 characters", { firstName: "a".repeat(101) }, "firstName"],
      ["an empty last name", { lastName: "  " }, "lastName"],
      ["a last name over 100 characters", { lastName: "b".repeat(101) }, "lastName"],
      ["an invalid e-mail", { email: "ana-at-example" }, "email"],
      ["an e-mail over 254 characters", { email: `${"a".repeat(250)}@example.test` }, "email"],
      [
        "a password under 8 characters",
        { password: "short", confirmPassword: "short" },
        "password",
      ],
      [
        "a password over 128 characters",
        { password: "p".repeat(129), confirmPassword: "p".repeat(129) },
        "password",
      ],
      ["different passwords", { confirmPassword: "another password" }, "confirmPassword"],
      ["an extra field", { isAdmin: true }, "isAdmin"],
    ])(
      "rejects %s with 400 VALIDATION_FAILED and creates nothing",
      async (_label, override, field) => {
        const email = newEmail("invalid");
        const response = await request(app.getHttpServer())
          .post(SIGN_UP_PATH)
          .send(validBody("email" in override ? (override.email as string) : email, override));

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("VALIDATION_FAILED");
        expect(
          response.body.error.details.map((detail: { field: string }) => detail.field),
        ).toContain(field);
        expect(await findUser(email)).toBeNull();
      },
    );

    it("tells the user that the passwords do not match", async () => {
      const response = await request(app.getHttpServer())
        .post(SIGN_UP_PATH)
        .send(validBody(newEmail("mismatch"), { confirmPassword: "different" }));

      expect(response.body.error.details).toEqual([
        { field: "confirmPassword", message: "Passwords do not match" },
      ]);
    });
  });

  describe("R4: repeated e-mail", () => {
    it("answers 409 EMAIL_ALREADY_REGISTERED for the same address in another case and sends no mail", async () => {
      const email = newEmail("dup-case");
      const http = request(app.getHttpServer());

      expect((await http.post(SIGN_UP_PATH).send(validBody(email))).status).toBe(201);
      clearCapturedEmails();

      const second = await http.post(SIGN_UP_PATH).send(validBody(`  ${email.toUpperCase()}  `));

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
      expect(second.body.error.details).toEqual([
        { field: "email", message: "An account with this email already exists." },
      ]);
      expect(getCapturedEmails({ to: email })).toEqual([]);
    });

    it("lets exactly one of two simultaneous requests win and never answers 500", async () => {
      const email = newEmail("race");
      const send = () => request(app.getHttpServer()).post(SIGN_UP_PATH).send(validBody(email));
      const responses = await Promise.all([send(), send()]);

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

      const users = await listUsersByEmail(email);

      expect(users).toHaveLength(1);
    });
  });

  describe("R5: confirmation token and e-mail", () => {
    it("stores only the hash of a 24 hour token and mails a link that hashes to it", async () => {
      const email = newEmail("confirm");
      const before = Date.now();
      const response = await request(app.getHttpServer())
        .post(SIGN_UP_PATH)
        .send(validBody(email, { firstName: "Bianca" }));

      expect(response.status).toBe(201);
      await app.get(EmailService).drain();

      const messages = getCapturedEmails({ to: email });

      expect(messages).toHaveLength(1);

      const [message] = messages;
      const appUrl = process.env.APP_URL as string;
      const pattern = new RegExp(`${appUrl}/auth/confirm-account\\?token=([A-Za-z0-9_-]+)`);
      const token = pattern.exec(message?.text ?? "")?.[1];

      expect(message?.subject).toBe("Confirm your email address");
      expect(message?.text).toContain("Bianca");
      expect(message?.html).toContain(`${appUrl}/auth/confirm-account?token=${token}`);
      expect(token).toBeDefined();

      const user = await findUser(email);
      const tokens = await listTokensOfUser(user?.id as string);

      expect(tokens).toHaveLength(1);

      const stored = tokens[0];
      const hashOfLinkToken = createHash("sha256")
        .update(token as string)
        .digest("hex");
      const expiresIn = (stored?.expires_at.getTime() ?? 0) - before;

      expect(stored?.token_hash).toBe(hashOfLinkToken);
      expect(JSON.stringify(stored)).not.toContain(token as string);
      expect(stored).toMatchObject({ type: "email_confirmation", used_at: null });
      expect(expiresIn).toBeGreaterThan(24 * 60 * 60 * 1000 - 60_000);
      expect(expiresIn).toBeLessThan(24 * 60 * 60 * 1000 + 60_000);
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

    it("still answers 201, keeps the user and token, and logs the failure without PII", async () => {
      resetRateLimitStore(failingApp);

      const email = newEmail("mail-down");
      const error = vi.spyOn(baseLogger, "error");
      const response = await request(failingApp.getHttpServer())
        .post(SIGN_UP_PATH)
        .send(validBody(email));

      await failingApp.get(EmailService).drain();

      expect(response.status).toBe(201);

      const user = await findUser(email);
      const tokens = await listTokensOfUser(user?.id as string);

      expect(user).not.toBeNull();
      expect(tokens).toHaveLength(1);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "email_delivery_failed",
          errorCode: "PROVIDER_UNAVAILABLE",
        }),
        "email_delivery_failed",
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain(email);
      expect(JSON.stringify(error.mock.calls)).not.toContain(PASSWORD);
    });
  });

  describe("R7: rate limit", () => {
    it("answers 429 RATE_LIMITED on the 6th request of the same IP and creates nothing for it", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await http
          .post(SIGN_UP_PATH)
          .send(validBody(newEmail(`limit-${attempt}`)));

        expect(response.status).toBe(201);
      }

      const email = newEmail("limit-blocked");
      const blocked = await http.post(SIGN_UP_PATH).send(validBody(email));

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(await findUser(email)).toBeNull();
    });
  });
});
