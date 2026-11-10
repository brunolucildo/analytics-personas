export interface RateLimitHit {
  /** Requests counted in the current window, including this one. */
  count: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
}

/**
 * Port for the request counters. The in-memory adapter serves a single API
 * instance; a distributed adapter (Redis) can replace it without touching the guard.
 */
export interface RateLimitStore {
  /** Counts one request for `key` in a fixed window of `windowMs` milliseconds. */
  hit(key: string, windowMs: number): RateLimitHit;
  /** Drops every counter. Meant for tests. */
  reset(): void;
}
