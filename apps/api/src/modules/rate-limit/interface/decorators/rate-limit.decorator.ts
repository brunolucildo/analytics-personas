import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_METADATA = "rate-limit:policy";

/**
 * Opts a route (or a whole controller) into rate limiting with a named policy
 * from the policy registry. Routes without this decorator are never limited.
 * With several policies they are checked in the order given and the first one over its limit
 * answers 429 (list the cheapest and broadest, such as one per IP, first).
 */
export const RateLimit = (...policies: [string, ...string[]]) =>
  SetMetadata(RATE_LIMIT_METADATA, policies);
