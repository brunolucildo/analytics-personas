import { RATE_LIMIT_STORE, type RateLimitStore } from "../../src/modules/rate-limit";

interface ResolvesProviders {
  get<T>(token: symbol): T;
}

/**
 * Clears every rate limit counter of the given Nest app (or testing module), so
 * a test never inherits quota from another. Call it in `beforeEach`.
 */
export function resetRateLimitStore(app: ResolvesProviders): void {
  app.get<RateLimitStore>(RATE_LIMIT_STORE).reset();
}

/** A clock the test can move forward, for `RATE_LIMIT_CLOCK`. */
export function createFakeClock(start = 1_700_000_000_000) {
  let current = start;

  return {
    now: () => current,
    advanceSeconds(seconds: number) {
      current += seconds * 1000;
    },
  };
}
