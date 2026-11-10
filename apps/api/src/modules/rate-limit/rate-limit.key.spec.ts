import { describe, expect, it } from "vitest";
import { buildRateLimitKey, normalizeEmail } from "./rate-limit.key";
import type { RateLimitPolicy } from "./rate-limit.policies";

const byIp: RateLimitPolicy = { limit: 3, windowSeconds: 60, keyBy: "ip" };
const byIpAndEmail: RateLimitPolicy = { limit: 3, windowSeconds: 60, keyBy: "ip-and-email" };
const base = { route: "AuthController.signIn", policyName: "sign-in", ip: "203.0.113.1" };

describe("normalizeEmail", () => {
  it("trims and lowercases a string", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it.each([undefined, null, 42, ["a@b.c"], {}, "   "])("ignores %j", (value) => {
    expect(normalizeEmail(value)).toBeUndefined();
  });
});

describe("buildRateLimitKey", () => {
  it("gives equivalent e-mails the same key", () => {
    const a = buildRateLimitKey(byIpAndEmail, { ...base, email: "ana@example.com" });
    const b = buildRateLimitKey(byIpAndEmail, { ...base, email: "  ANA@Example.com" });

    expect(a).toBe(b);
  });

  it("splits by e-mail and by IP for an IP + e-mail policy", () => {
    const reference = buildRateLimitKey(byIpAndEmail, { ...base, email: "ana@example.com" });

    expect(buildRateLimitKey(byIpAndEmail, { ...base, email: "bia@example.com" })).not.toBe(
      reference,
    );
    expect(
      buildRateLimitKey(byIpAndEmail, { ...base, ip: "203.0.113.2", email: "ana@example.com" }),
    ).not.toBe(reference);
  });

  it("ignores the e-mail for a per-IP policy", () => {
    const a = buildRateLimitKey(byIp, { ...base, email: "ana@example.com" });
    const b = buildRateLimitKey(byIp, { ...base, email: "bia@example.com" });

    expect(a).toBe(b);
  });

  it("falls back to the per-IP key when the e-mail is not a string", () => {
    const withoutEmail = buildRateLimitKey(byIpAndEmail, { ...base, email: undefined });

    expect(buildRateLimitKey(byIpAndEmail, { ...base, email: 42 })).toBe(withoutEmail);
    expect(buildRateLimitKey(byIpAndEmail, { ...base, email: ["a@b.c"] })).toBe(withoutEmail);
  });

  it("separates routes and policies", () => {
    const reference = buildRateLimitKey(byIp, { ...base, email: undefined });

    expect(
      buildRateLimitKey(byIp, { ...base, route: "AuthController.signUp", email: undefined }),
    ).not.toBe(reference);
    expect(buildRateLimitKey(byIp, { ...base, policyName: "sign-up", email: undefined })).not.toBe(
      reference,
    );
  });

  it("does not expose the IP or the e-mail in the key", () => {
    const key = buildRateLimitKey(byIpAndEmail, { ...base, email: "ana@example.com" });

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.1");
    expect(key).not.toContain("ana");
  });
});
