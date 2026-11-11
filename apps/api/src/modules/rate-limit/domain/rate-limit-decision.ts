import type { RateLimitHit } from "./rate-limit-ports";
import type { RateLimitPolicy } from "./rate-limit-policy";

/** The request fits in the policy limit and may proceed. */
export interface RateLimitAllowed {
  status: "allowed";
}

/** The request is over the policy limit; `retryAfterSeconds` is always at least 1. */
export interface RateLimitLimited {
  status: "limited";
  retryAfterSeconds: number;
}

export type RateLimitDecision = RateLimitAllowed | RateLimitLimited;

/**
 * Decides one policy from the counter read: over the limit when `count` exceeds
 * `limit`, with a retry of whole seconds until the window ends (never below 1).
 */
export function evaluateRateLimit(
  policy: RateLimitPolicy,
  hit: RateLimitHit,
  nowMs: number,
): RateLimitDecision {
  if (hit.count <= policy.limit) {
    return { status: "allowed" };
  }

  return {
    status: "limited",
    retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - nowMs) / 1000)),
  };
}
