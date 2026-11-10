import { describe, expect, it } from "vitest";
import { parseEmailConfig, parseEmailFrom } from "./email-config";

const from = "Analytics Personas <no-reply@analytics-personas.local>";

describe("parseEmailConfig", () => {
  it("accepts capture with a named sender", () => {
    expect(parseEmailConfig({ EMAIL_PROVIDER: "capture", EMAIL_FROM: from })).toEqual({
      provider: "capture",
      from: { name: "Analytics Personas", address: "no-reply@analytics-personas.local" },
    });
  });

  it("accepts mailtrap with token and inbox id", () => {
    expect(
      parseEmailConfig({
        EMAIL_PROVIDER: "mailtrap",
        EMAIL_FROM: from,
        MAILTRAP_API_TOKEN: "token-value",
        MAILTRAP_INBOX_ID: "123456",
      }),
    ).toMatchObject({ provider: "mailtrap", apiToken: "token-value", inboxId: "123456" });
  });

  it("accepts resend in production", () => {
    expect(
      parseEmailConfig({
        NODE_ENV: "production",
        EMAIL_PROVIDER: "resend",
        EMAIL_FROM: "no-reply@example.com",
        RESEND_API_KEY: "key-value",
      }),
    ).toMatchObject({ provider: "resend", apiKey: "key-value" });
  });

  it.each([undefined, "", "smtp", "Mailtrap"])(
    "fails naming EMAIL_PROVIDER when it is %j",
    (value) => {
      expect(() => parseEmailConfig({ EMAIL_PROVIDER: value, EMAIL_FROM: from })).toThrowError(
        /EMAIL_PROVIDER/,
      );
    },
  );

  it.each(["capture", "mailtrap"])("refuses %s when NODE_ENV is production", (provider) => {
    expect(() =>
      parseEmailConfig({
        NODE_ENV: "production",
        EMAIL_PROVIDER: provider,
        EMAIL_FROM: from,
        MAILTRAP_API_TOKEN: "token-value",
        MAILTRAP_INBOX_ID: "1",
      }),
    ).toThrowError(/EMAIL_PROVIDER.*production/);
  });

  it.each([undefined, "", "not-an-address", "Name <broken>", "a@b"])(
    "fails naming EMAIL_FROM when it is %j",
    (value) => {
      expect(() => parseEmailConfig({ EMAIL_PROVIDER: "capture", EMAIL_FROM: value })).toThrowError(
        /EMAIL_FROM/,
      );
    },
  );

  it.each([
    [{ MAILTRAP_INBOX_ID: "1" }, /MAILTRAP_API_TOKEN/],
    [{ MAILTRAP_API_TOKEN: "token-value" }, /MAILTRAP_INBOX_ID/],
    [{ MAILTRAP_API_TOKEN: "token-value", MAILTRAP_INBOX_ID: "abc" }, /MAILTRAP_INBOX_ID/],
  ])("fails naming the missing mailtrap variable (%j)", (extra, pattern) => {
    expect(() =>
      parseEmailConfig({ EMAIL_PROVIDER: "mailtrap", EMAIL_FROM: from, ...extra }),
    ).toThrowError(pattern);
  });

  it("fails naming RESEND_API_KEY when it is missing", () => {
    expect(() => parseEmailConfig({ EMAIL_PROVIDER: "resend", EMAIL_FROM: from })).toThrowError(
      /RESEND_API_KEY/,
    );
  });

  it("does not echo credential values in errors", () => {
    expect(() =>
      parseEmailConfig({
        EMAIL_PROVIDER: "mailtrap",
        EMAIL_FROM: from,
        MAILTRAP_API_TOKEN: "super-secret-token",
        MAILTRAP_INBOX_ID: "not-numeric",
      }),
    ).toThrowError(expect.not.stringContaining("super-secret-token"));
  });
});

describe("parseEmailFrom", () => {
  it("parses a bare address and a quoted name", () => {
    expect(parseEmailFrom("no-reply@example.com")).toEqual({ address: "no-reply@example.com" });
    expect(parseEmailFrom('"Analytics Personas" <no-reply@example.com>')).toEqual({
      name: "Analytics Personas",
      address: "no-reply@example.com",
    });
  });
});
