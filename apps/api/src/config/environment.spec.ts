import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./environment";

const validEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  APP_URL: "http://localhost:5173",
  EMAIL_PROVIDER: "capture",
  EMAIL_FROM: "Analytics Personas <no-reply@analytics-personas.local>",
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
});
