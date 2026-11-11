import { describe, expect, it } from "vitest";
import { NodeCryptoKeyHasher } from "../infrastructure/node-crypto-key-hasher";
import { buildRateLimitKey, normalizeEmail, type RateLimitKeyParts } from "./rate-limit-key";
import type { RateLimitPolicy } from "./rate-limit-policy";

const hasher = new NodeCryptoKeyHasher();
const key = (policy: RateLimitPolicy, parts: RateLimitKeyParts) =>
  buildRateLimitKey(policy, parts, hasher);

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
    const a = key(byIpAndEmail, { ...base, email: "ana@example.com" });
    const b = key(byIpAndEmail, { ...base, email: "  ANA@Example.com" });

    expect(a).toBe(b);
  });

  it("splits by e-mail and by IP for an IP + e-mail policy", () => {
    const reference = key(byIpAndEmail, { ...base, email: "ana@example.com" });

    expect(key(byIpAndEmail, { ...base, email: "bia@example.com" })).not.toBe(reference);
    expect(key(byIpAndEmail, { ...base, ip: "203.0.113.2", email: "ana@example.com" })).not.toBe(
      reference,
    );
  });

  it("ignores the e-mail for a per-IP policy", () => {
    const a = key(byIp, { ...base, email: "ana@example.com" });
    const b = key(byIp, { ...base, email: "bia@example.com" });

    expect(a).toBe(b);
  });

  it("falls back to the per-IP key when the e-mail is not a string", () => {
    const withoutEmail = key(byIpAndEmail, { ...base, email: undefined });

    expect(key(byIpAndEmail, { ...base, email: 42 })).toBe(withoutEmail);
    expect(key(byIpAndEmail, { ...base, email: ["a@b.c"] })).toBe(withoutEmail);
  });

  it("separates routes and policies", () => {
    const reference = key(byIp, { ...base, email: undefined });

    expect(key(byIp, { ...base, route: "AuthController.signUp", email: undefined })).not.toBe(
      reference,
    );
    expect(key(byIp, { ...base, policyName: "sign-up", email: undefined })).not.toBe(reference);
  });

  it("does not expose the IP or the e-mail in the key", () => {
    const hashed = buildRateLimitKey(byIpAndEmail, { ...base, email: "ana@example.com" }, hasher);

    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113.1");
    expect(hashed).not.toContain("ana");
  });
});
