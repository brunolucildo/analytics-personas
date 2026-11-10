import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_METADATA = "rate-limit:policy";

/**
 * Opts a route (or a whole controller) into rate limiting with a named policy
 * from the policy registry. Routes without this decorator are never limited.
 */
export const RateLimit = (policy: string) => SetMetadata(RATE_LIMIT_METADATA, policy);
