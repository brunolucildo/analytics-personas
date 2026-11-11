/**
 * Raised when a `@RateLimit(...)` decorator names a policy that is not in the
 * registry. It is a programming error, so it must not be swallowed: a typo would
 * otherwise leave the route silently unprotected.
 */
export class UnknownRateLimitPolicyError extends Error {
  constructor(policyName: string) {
    super(`Unknown rate limit policy "${policyName}".`);
    this.name = "UnknownRateLimitPolicyError";
  }
}
