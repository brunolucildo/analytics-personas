import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { HASH_LIMITER } from "../src/modules/auth/auth.tokens";
import { HashCapacityExceededError } from "../src/modules/auth/domain/auth-errors";
import { HashLimiter } from "../src/modules/auth/infrastructure/hash-limiter";
import { clearCapturedEmails } from "../src/modules/email/testing";
import { baseLogger } from "../src/observability/logger";
import { resetRateLimitStore } from "./support/rate-limit";
import { type TelemetryRecorder, startTelemetryRecorder } from "./support/telemetry";
import {
  assertMigrationsApplied,
  deleteUsersByEmail,
  listUsersByEmail,
  uniqueEmail,
} from "./support/database";

const PREFIX = "/api/v1/auth";
const WRONG_PASSWORD = "Sentinel-Wrong-93f1c7";

describe("password hash protection (real API)", () => {
  const createdEmails: string[] = [];
  const apps: INestApplication[] = [];
  let recorder: TelemetryRecorder;

  async function buildApp(hashLimiter?: unknown): Promise<INestApplication> {
    let builder = Test.createTestingModule({ imports: [AppModule] });

    if (hashLimiter !== undefined) {
      builder = builder.overrideProvider(HASH_LIMITER).useValue(hashLimiter);
    }

    const app = (await builder.compile()).createNestApplication();

    configureApp(app);
    await app.init();
    apps.push(app);

    return app;
  }

  const signIn = (app: INestApplication, email: string) =>
    request(app.getHttpServer())
      .post(`${PREFIX}/sign-in`)
      .send({ email, password: WRONG_PASSWORD });

  beforeAll(async () => {
    await assertMigrationsApplied();
    recorder = startTelemetryRecorder();
  });

  afterAll(async () => {
    for (const app of apps) await app.close();

    await recorder.stop();
    await deleteUsersByEmail(createdEmails);
  });

  beforeEach(() => {
    recorder.reset();
  });

  afterEach(() => {
    clearCapturedEmails();
    vi.restoreAllMocks();
  });

  describe("sign-in per IP, whatever the e-mail", () => {
    it("blocks the 61st sign-in of one IP even though every e-mail is different", async () => {
      const app = await buildApp();
      const warn = vi.spyOn(baseLogger, "warn");

      resetRateLimitStore(app);

      const statuses: number[] = [];
      let last = await signIn(app, uniqueEmail("ip-0"));

      statuses.push(last.status);

      for (let batch = 0; batch < 6; batch += 1) {
        const responses = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            signIn(app, uniqueEmail(`ip-${batch}-${index}`)),
          ),
        );

        for (const response of responses) {
          statuses.push(response.status);
          last = response;
        }
      }

      expect(statuses).toHaveLength(61);
      expect(statuses.filter((status) => status === 401)).toHaveLength(60);
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);

      const blocked = [
        await signIn(app, uniqueEmail("ip-after-1")),
        await signIn(app, uniqueEmail("ip-after-2")),
      ];

      for (const response of blocked) {
        expect(response.status).toBe(429);
        expect(response.body.error.code).toBe("RATE_LIMITED");
        expect(Number(response.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      }

      // The broad per-IP policy answered, before the per IP and e-mail one was even counted.
      const policies = warn.mock.calls
        .map(([fields]) => fields as { event?: string; policy?: string })
        .filter((fields) => fields?.event === "rate_limited")
        .map((fields) => fields.policy);

      expect(new Set(policies)).toEqual(new Set(["sign-in-ip"]));
      expect(last).toBeDefined();
    }, 60_000);

    it("keeps the per IP and e-mail limit: the 11th try for one e-mail is blocked by its own policy", async () => {
      const app = await buildApp();
      const warn = vi.spyOn(baseLogger, "warn");
      const email = uniqueEmail("same");

      resetRateLimitStore(app);

      const statuses: number[] = [];

      for (let attempt = 0; attempt < 11; attempt += 1) {
        statuses.push((await signIn(app, email)).status);
      }

      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      expect(statuses[10]).toBe(429);

      const policies = warn.mock.calls
        .map(([fields]) => fields as { event?: string; policy?: string })
        .filter((fields) => fields?.event === "rate_limited")
        .map((fields) => fields.policy);

      expect(policies).toEqual(["sign-in"]);
    }, 60_000);
  });

  describe("when the hash queue is full", () => {
    const full = { run: () => Promise.reject(new HashCapacityExceededError(3)) };

    it("answers sign-in with 503 SERVICE_BUSY and Retry-After, not as a crash", async () => {
      const app = await buildApp(full);
      const error = vi.spyOn(baseLogger, "error");

      resetRateLimitStore(app);

      const response = await signIn(app, uniqueEmail("busy-in"));

      expect(response.status).toBe(503);
      expect(response.headers["retry-after"]).toBe("3");
      expect(response.body).toEqual({
        error: {
          code: "SERVICE_BUSY",
          message: "The service is busy right now. Try again shortly.",
          details: [{ retryAfterSeconds: 3 }],
        },
      });
      expect(error.mock.calls.some(([, message]) => message === "unhandled_exception")).toBe(false);
    });

    it("refuses a sign-up before it creates the account", async () => {
      const app = await buildApp(full);
      const email = uniqueEmail("busy-up");

      createdEmails.push(email);
      resetRateLimitStore(app);

      const response = await request(app.getHttpServer()).post(`${PREFIX}/sign-up`).send({
        firstName: "Busy",
        lastName: "Queue",
        email,
        password: "Sentinel-Pass-93f1c7",
        confirmPassword: "Sentinel-Pass-93f1c7",
      });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVICE_BUSY");

      const users = await listUsersByEmail(email);

      expect(users).toEqual([]);
    });

    it("refuses a password reset before it touches the token", async () => {
      const app = await buildApp(full);

      resetRateLimitStore(app);

      const response = await request(app.getHttpServer()).post(`${PREFIX}/reset-password`).send({
        token: "not-a-real-token",
        password: "Sentinel-New-71ab02",
        confirmPassword: "Sentinel-New-71ab02",
      });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVICE_BUSY");
    });

    it("counts the refusal as reason service_busy, with no client data in the labels", async () => {
      const app = await buildApp(full);

      resetRateLimitStore(app);
      // Metrics are delta: drain what the earlier tests left unread before starting from zero.
      await recorder.metric("auth.operations");
      recorder.reset();

      await signIn(app, uniqueEmail("busy-metric"));

      const points = await recorder.metric("auth.operations");
      const busy = points.find((point) => point.attributes.reason === "service_busy");

      expect(busy?.attributes).toEqual({
        operation: "sign_in",
        outcome: "failure",
        reason: "service_busy",
      });
      expect(busy?.value).toBe(1);
    });
  });

  describe("with a small real limiter", () => {
    it("serves what fits, refuses the rest with 503 and takes new work once it drains", async () => {
      const limiter = new HashLimiter({ concurrency: 1, maxQueue: 1 });
      const app = await buildApp(limiter);

      resetRateLimitStore(app);

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) => signIn(app, uniqueEmail(`small-${index}`))),
      );
      const statuses = responses.map((response) => response.status);

      expect(statuses.every((status) => status === 401 || status === 503)).toBe(true);
      expect(statuses.filter((status) => status === 401).length).toBeGreaterThanOrEqual(2);
      expect(statuses.filter((status) => status === 503).length).toBeGreaterThanOrEqual(1);

      for (const response of responses.filter((item) => item.status === 503)) {
        expect(response.headers["retry-after"]).toMatch(/^\d+$/);
        expect(response.body.error.code).toBe("SERVICE_BUSY");
      }

      expect(limiter.activeCount).toBe(0);
      expect(limiter.queuedCount).toBe(0);
      expect((await signIn(app, uniqueEmail("small-after"))).status).toBe(401);
    }, 60_000);
  });
});
