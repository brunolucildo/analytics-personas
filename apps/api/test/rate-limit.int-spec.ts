import { Body, Controller, Get, type INestApplication, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import {
  AUTH_RATE_LIMIT_POLICIES,
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_STORE,
  RateLimit,
  type RateLimitStore,
} from "../src/modules/rate-limit";
import { baseLogger } from "../src/observability/logger";
import { createFakeClock, resetRateLimitStore } from "./support/rate-limit";

const TEST_POLICIES = {
  ...AUTH_RATE_LIMIT_POLICIES,
  "probe-ip": { limit: 3, windowSeconds: 60, keyBy: "ip" },
  "probe-email": { limit: 3, windowSeconds: 60, keyBy: "ip-and-email" },
} as const;

@Controller("probe")
class RateLimitProbeController {
  @Get("limited")
  @RateLimit("probe-ip")
  limited() {
    return { ok: true };
  }

  @Post("by-email")
  @RateLimit("probe-email")
  byEmail(@Body() body: unknown) {
    return { received: typeof body };
  }

  @Get("typo")
  @RateLimit("does-not-exist")
  typo() {
    return { ok: true };
  }

  @Get("open")
  open() {
    return { ok: true };
  }
}

interface BuildOptions {
  trustProxy?: boolean;
  store?: RateLimitStore;
}

describe("Rate limiting", () => {
  const clock = createFakeClock();
  let app: INestApplication;

  async function buildApp({ trustProxy = false, store }: BuildOptions = {}) {
    const environment: Record<string, unknown> = {
      appUrl: "http://localhost:5173",
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseServiceRoleKey: "test-service-role-key",
      trustProxy,
      email: { provider: "capture", from: { name: "Test", address: "no-reply@test.local" } },
    };
    let builder = Test.createTestingModule({
      imports: [AppModule],
      controllers: [RateLimitProbeController],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: (name: string) => environment[name] })
      .overrideProvider(RATE_LIMIT_POLICIES)
      .useValue(TEST_POLICIES)
      .overrideProvider(RATE_LIMIT_CLOCK)
      .useValue(clock.now);

    if (store !== undefined) {
      builder = builder.overrideProvider(RATE_LIMIT_STORE).useValue(store);
    }

    const moduleRef = await builder.compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  describe("with the default proxy setting", () => {
    beforeEach(async () => {
      await buildApp();
      resetRateLimitStore(app);
    });

    it("lets 3 requests through and answers the 4th with 429, Retry-After and the envelope", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await http.get("/api/v1/probe/limited");

        expect(response.status).toBe(200);
      }

      const blocked = await http.get("/api/v1/probe/limited");

      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBe("60");
      expect(blocked.body).toEqual({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again later.",
          details: [{ retryAfterSeconds: 60 }],
        },
      });
    });

    it("reports the time left in the window as an integer of at least 1 second", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await http.get("/api/v1/probe/limited");
      }

      clock.advanceSeconds(59.4);

      const blocked = await http.get("/api/v1/probe/limited");

      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBe("1");
      expect(blocked.body.error.details).toEqual([{ retryAfterSeconds: 1 }]);
    });

    it("never limits a route without the decorator", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await http.get("/api/v1/probe/open");

        expect(response.status).toBe(200);
      }
    });

    it("never limits the health check", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await http.get("/api/v1/health");

        expect(response.status).toBe(200);
      }
    });

    it("starts a new window once the old one has ended", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await http.get("/api/v1/probe/limited");
      }

      expect((await http.get("/api/v1/probe/limited")).status).toBe(429);

      clock.advanceSeconds(61);

      expect((await http.get("/api/v1/probe/limited")).status).toBe(200);

      // The count restarted: two more fit, the third request of the new window is the last.
      expect((await http.get("/api/v1/probe/limited")).status).toBe(200);
      expect((await http.get("/api/v1/probe/limited")).status).toBe(200);
      expect((await http.get("/api/v1/probe/limited")).status).toBe(429);
    });

    it("gives every e-mail its own quota and treats equivalent e-mails as one", async () => {
      const http = request(app.getHttpServer());
      const send = (email: string) => http.post("/api/v1/probe/by-email").send({ email });

      expect((await send("ana@example.com")).status).toBe(201);
      expect((await send("ANA@example.com")).status).toBe(201);
      expect((await send("  ana@example.com  ")).status).toBe(201);
      expect((await send("Ana@Example.com")).status).toBe(429);

      // A different e-mail from the same IP still has its whole quota.
      expect((await send("bia@example.com")).status).toBe(201);
    });

    it("falls back to the per-IP key when the body has no string e-mail", async () => {
      const http = request(app.getHttpServer());

      expect((await http.post("/api/v1/probe/by-email").send({ email: 42 })).status).toBe(201);
      expect((await http.post("/api/v1/probe/by-email").send({})).status).toBe(201);
      expect((await http.post("/api/v1/probe/by-email")).status).toBe(201);
      expect((await http.post("/api/v1/probe/by-email").send({ email: ["a"] })).status).toBe(429);
    });

    it("clears every counter with resetRateLimitStore", async () => {
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await http.get("/api/v1/probe/limited");
      }

      expect((await http.get("/api/v1/probe/limited")).status).toBe(429);

      resetRateLimitStore(app);

      expect((await http.get("/api/v1/probe/limited")).status).toBe(200);
    });

    it("fails loudly for a decorator that names an unknown policy", async () => {
      const response = await request(app.getHttpServer()).get("/api/v1/probe/typo");

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
    });

    it("logs only the event and the policy name when it blocks", async () => {
      const warn = vi.spyOn(baseLogger, "warn");
      const error = vi.spyOn(baseLogger, "error");
      const http = request(app.getHttpServer());
      const email = "secret.person@example.com";

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await http.post("/api/v1/probe/by-email").send({ email });
      }

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { event: "rate_limited", policy: "probe-email" },
        "rate_limited",
      );
      expect(error).not.toHaveBeenCalled();

      const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);

      expect(logged).not.toContain(email);
      expect(logged).not.toMatch(/127\.0\.0\.1|::1|::ffff/);
    });
  });

  describe("client IP", () => {
    async function hitAs(forwardedFor: string) {
      return request(app.getHttpServer())
        .get("/api/v1/probe/limited")
        .set("X-Forwarded-For", forwardedFor);
    }

    it("ignores X-Forwarded-For when TRUST_PROXY is false", async () => {
      await buildApp({ trustProxy: false });

      for (const forwardedFor of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
        expect((await hitAs(forwardedFor)).status).toBe(200);
      }

      // Every request came from the same socket address, so the quota is shared.
      expect((await hitAs("203.0.113.4")).status).toBe(429);
    });

    it("uses the first X-Forwarded-For address when TRUST_PROXY is true", async () => {
      await buildApp({ trustProxy: true });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await hitAs("203.0.113.1, 10.0.0.1")).status).toBe(200);
      }

      expect((await hitAs("203.0.113.1, 10.0.0.2")).status).toBe(429);
      expect((await hitAs("203.0.113.9, 10.0.0.1")).status).toBe(200);
    });
  });

  describe("when the store fails", () => {
    it("lets the request through and logs rate_limit_store_error without PII", async () => {
      const failingStore: RateLimitStore = {
        hit() {
          throw new Error("store down for ana@example.com");
        },
        reset() {},
      };

      await buildApp({ store: failingStore });

      const error = vi.spyOn(baseLogger, "error");
      const http = request(app.getHttpServer());

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await http.get("/api/v1/probe/limited")).status).toBe(200);
      }

      expect(error).toHaveBeenCalledTimes(5);
      expect(error).toHaveBeenCalledWith(
        { event: "rate_limit_store_error", policy: "probe-ip" },
        "rate_limit_store_error",
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain("ana@example.com");
    });
  });
});
