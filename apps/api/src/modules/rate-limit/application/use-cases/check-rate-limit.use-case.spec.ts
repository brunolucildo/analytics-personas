import { describe, expect, it } from "vitest";
import { UnknownRateLimitPolicyError } from "../../domain/rate-limit-errors";
import type { RateLimitHit, RateLimitStore } from "../../domain/rate-limit-ports";
import type { RateLimitPolicies } from "../../domain/rate-limit-policy";
import { CheckRateLimit } from "./check-rate-limit.use-case";

const now = 1_000_000;
const policies: RateLimitPolicies = {
  first: { limit: 1, windowSeconds: 60, keyBy: "ip" },
  second: { limit: 1, windowSeconds: 60, keyBy: "ip-and-email" },
};

/** Hasher that keeps the key readable so the fake store can key its counts by policy. */
const hasher = { hash: (raw: string) => raw };

function policyOf(key: string): string {
  return (JSON.parse(key) as string[])[1] ?? "";
}

function createStore(
  counts: Record<string, number> = {},
  failing: readonly string[] = [],
): RateLimitStore & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    hit(key: string): RateLimitHit {
      const policy = policyOf(key);

      calls.push(policy);

      if (failing.includes(policy)) {
        throw new Error(`store down for ${policy}`);
      }

      return { count: counts[policy] ?? 1, resetAt: now + 60_000 };
    },
    reset() {},
  };
}

const command = {
  policyNames: ["first", "second"],
  route: "SignInRequestHandler.handle",
  ip: "203.0.113.1",
  email: "ana@example.com",
};

describe("CheckRateLimit", () => {
  it("checks the policies in the order given and stops at the first one over its limit", () => {
    const store = createStore({ first: 2 });
    const check = new CheckRateLimit(store, policies, hasher, () => now);

    expect(check.execute(command)).toEqual({
      decision: { status: "limited", retryAfterSeconds: 60 },
      policyName: "first",
      unavailablePolicies: [],
    });
    expect(store.calls).toEqual(["first"]);
  });

  it("reaches the second policy when the first one is under its limit", () => {
    const store = createStore({ second: 2 });
    const check = new CheckRateLimit(store, policies, hasher, () => now);

    expect(check.execute(command)).toEqual({
      decision: { status: "limited", retryAfterSeconds: 60 },
      policyName: "second",
      unavailablePolicies: [],
    });
    expect(store.calls).toEqual(["first", "second"]);
  });

  it("allows the request when every policy is under its limit", () => {
    const check = new CheckRateLimit(createStore(), policies, hasher, () => now);

    expect(check.execute(command)).toEqual({
      decision: { status: "allowed" },
      unavailablePolicies: [],
    });
  });

  it("fails open and reports every unreadable policy when no later policy blocks", () => {
    const store = createStore({}, ["first", "second"]);
    const check = new CheckRateLimit(store, policies, hasher, () => now);

    expect(check.execute(command)).toEqual({
      decision: { status: "allowed" },
      unavailablePolicies: ["first", "second"],
    });
    expect(store.calls).toEqual(["first", "second"]);
  });

  it("still blocks when a later policy is over its limit after a store failure", () => {
    const store = createStore({ second: 2 }, ["first"]);
    const check = new CheckRateLimit(store, policies, hasher, () => now);

    expect(check.execute(command)).toEqual({
      decision: { status: "limited", retryAfterSeconds: 60 },
      policyName: "second",
      unavailablePolicies: ["first"],
    });
    expect(store.calls).toEqual(["first", "second"]);
  });

  it("fails loudly for an unknown policy", () => {
    const check = new CheckRateLimit(createStore(), policies, hasher, () => now);

    expect(() => check.execute({ ...command, policyNames: ["does-not-exist"] })).toThrow(
      new UnknownRateLimitPolicyError("does-not-exist"),
    );
    expect(() => check.execute({ ...command, policyNames: ["does-not-exist"] })).toThrow(
      'Unknown rate limit policy "does-not-exist".',
    );
  });
});
