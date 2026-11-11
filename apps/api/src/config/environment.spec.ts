import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./environment";

const validEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  APP_URL: "http://localhost:5173",
  EMAIL_PROVIDER: "capture",
  EMAIL_FROM: "Rondo <no-reply@rondo.local>",
  AUTH_JWT_SECRET: "unit-test-jwt-secret-0123456789-abcdefghij",
};

describe("validateEnvironment", () => {
  it("exposes APP_URL as the bare origin of the app", () => {
    const environment = validateEnvironment({
      ...validEnv,
      APP_URL: "https://app.example.com/ignored/path",
    });

    expect(environment.appUrl).toBe("https://app.example.com");
  });

  it("fails naming APP_URL when it is missing", () => {
    const { APP_URL: _removed, ...withoutAppUrl } = validEnv;

    expect(() => validateEnvironment(withoutAppUrl)).toThrowError(/APP_URL/);
  });

  it.each(["not-a-url", "ftp://localhost:5173", "localhost:5173", "javascript:alert(1)"])(
    "fails naming APP_URL when the value is %s",
    (value) => {
      expect(() => validateEnvironment({ ...validEnv, APP_URL: value })).toThrowError(/APP_URL/);
    },
  );

  describe("hash budget", () => {
    it("defaults to one slot below the default libuv thread pool and a queue of 64", () => {
      const environment = validateEnvironment(validEnv);

      expect(environment.authHashConcurrency).toBe(3);
      expect(environment.authHashQueueLimit).toBe(64);
    });

    it("follows UV_THREADPOOL_SIZE, always leaving one thread free", () => {
      expect(
        validateEnvironment({ ...validEnv, UV_THREADPOOL_SIZE: "8" }).authHashConcurrency,
      ).toBe(7);
      expect(
        validateEnvironment({ ...validEnv, UV_THREADPOOL_SIZE: "1" }).authHashConcurrency,
      ).toBe(1);
    });

    it("lets AUTH_HASH_CONCURRENCY and AUTH_HASH_QUEUE_LIMIT override the defaults", () => {
      const environment = validateEnvironment({
        ...validEnv,
        AUTH_HASH_CONCURRENCY: "2",
        AUTH_HASH_QUEUE_LIMIT: "0",
      });

      expect(environment.authHashConcurrency).toBe(2);
      expect(environment.authHashQueueLimit).toBe(0);
    });

    it.each([
      ["AUTH_HASH_CONCURRENCY", "0"],
      ["AUTH_HASH_CONCURRENCY", "2.5"],
      ["AUTH_HASH_CONCURRENCY", "many"],
      ["AUTH_HASH_QUEUE_LIMIT", "-1"],
      ["AUTH_HASH_QUEUE_LIMIT", "lots"],
      ["UV_THREADPOOL_SIZE", "0"],
    ])("fails naming %s when the value is %s", (name, value) => {
      expect(() => validateEnvironment({ ...validEnv, [name]: value })).toThrowError(
        new RegExp(name),
      );
    });
  });

  it("exposes the validated e-mail configuration", () => {
    expect(validateEnvironment(validEnv).email).toMatchObject({ provider: "capture" });
  });

  it("fails naming EMAIL_PROVIDER when it is missing", () => {
    const { EMAIL_PROVIDER: _removed, ...withoutProvider } = validEnv;

    expect(() => validateEnvironment(withoutProvider)).toThrowError(/EMAIL_PROVIDER/);
  });

  it("refuses capture in production", () => {
    expect(() => validateEnvironment({ ...validEnv, NODE_ENV: "production" })).toThrowError(
      /EMAIL_PROVIDER.*production/,
    );
  });

  it("still requires the Supabase variables", () => {
    expect(() => validateEnvironment({ APP_URL: validEnv.APP_URL })).toThrowError(/SUPABASE_URL/);
  });

  it("defaults TRUST_PROXY to false", () => {
    expect(validateEnvironment(validEnv).trustProxy).toBe(false);
  });

  it.each([
    ["true", true],
    ["TRUE", true],
    ["false", false],
  ])("reads TRUST_PROXY=%s as %s", (value, expected) => {
    expect(validateEnvironment({ ...validEnv, TRUST_PROXY: value }).trustProxy).toBe(expected);
  });

  it.each(["yes", "1", "maybe"])("fails naming TRUST_PROXY when the value is %s", (value) => {
    expect(() => validateEnvironment({ ...validEnv, TRUST_PROXY: value })).toThrowError(
      /TRUST_PROXY/,
    );
  });

  it("exposes the JWT secret", () => {
    expect(validateEnvironment(validEnv).authJwtSecret).toBe(validEnv.AUTH_JWT_SECRET);
  });

  it("accepts a secret of exactly 32 characters", () => {
    expect(() =>
      validateEnvironment({ ...validEnv, AUTH_JWT_SECRET: "x".repeat(32) }),
    ).not.toThrow();
  });

  it("fails naming AUTH_JWT_SECRET when it is missing", () => {
    const { AUTH_JWT_SECRET: _removed, ...withoutSecret } = validEnv;

    expect(() => validateEnvironment(withoutSecret)).toThrowError(/AUTH_JWT_SECRET/);
  });

  it("fails naming AUTH_JWT_SECRET, without echoing it, when it is shorter than 32 characters", () => {
    const short = "short-secret-31-characters-long";

    expect(short).toHaveLength(31);
    expect(() => validateEnvironment({ ...validEnv, AUTH_JWT_SECRET: short })).toThrowError(
      /AUTH_JWT_SECRET/,
    );
    expect(() => validateEnvironment({ ...validEnv, AUTH_JWT_SECRET: short })).not.toThrowError(
      new RegExp(short),
    );
  });
});
