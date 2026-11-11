import { describe, expect, it } from "vitest";
import { evaluateRateLimit } from "./rate-limit-decision";
import type { RateLimitPolicy } from "./rate-limit-policy";

const policy: RateLimitPolicy = { limit: 3, windowSeconds: 60, keyBy: "ip" };
const now = 1_000_000;

describe("evaluateRateLimit", () => {
  it("allows a hit under or at the limit", () => {
    expect(evaluateRateLimit(policy, { count: 1, resetAt: now + 60_000 }, now)).toEqual({
      status: "allowed",
    });
    expect(evaluateRateLimit(policy, { count: 3, resetAt: now + 60_000 }, now)).toEqual({
      status: "allowed",
    });
  });

  it("limits the first hit over the limit", () => {
    expect(evaluateRateLimit(policy, { count: 4, resetAt: now + 60_000 }, now)).toEqual({
      status: "limited",
      retryAfterSeconds: 60,
    });
  });

  it("rounds the retry up to a whole second", () => {
    expect(evaluateRateLimit(policy, { count: 4, resetAt: now + 59_400 }, now)).toEqual({
      status: "limited",
      retryAfterSeconds: 60,
    });
    expect(evaluateRateLimit(policy, { count: 4, resetAt: now + 400 }, now)).toEqual({
      status: "limited",
      retryAfterSeconds: 1,
    });
  });

  it("never reports a retry below one second", () => {
    expect(evaluateRateLimit(policy, { count: 4, resetAt: now }, now)).toEqual({
      status: "limited",
      retryAfterSeconds: 1,
    });
    expect(evaluateRateLimit(policy, { count: 4, resetAt: now - 5_000 }, now)).toEqual({
      status: "limited",
      retryAfterSeconds: 1,
    });
  });
});
