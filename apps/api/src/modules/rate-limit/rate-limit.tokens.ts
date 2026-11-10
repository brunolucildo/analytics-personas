export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");
export const RATE_LIMIT_POLICIES = Symbol("RATE_LIMIT_POLICIES");
export const RATE_LIMIT_CLOCK = Symbol("RATE_LIMIT_CLOCK");

/** Returns the current time in epoch milliseconds. Replaced in tests to move time. */
export type RateLimitClock = () => number;
