import type { RateLimitHit, RateLimitStore } from "./rate-limit-store";

export const DEFAULT_MAX_ENTRIES = 10_000;
const SWEEP_INTERVAL_MS = 60_000;
/** Minimum time between two full scans triggered by a new key arriving at the cap. */
const CAP_SWEEP_INTERVAL_MS = 1_000;

/**
 * Fixed-window counters kept in a `Map` (insertion ordered). Memory is bounded:
 * expired entries are swept lazily and, at the cap, the oldest entry is evicted.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitHit>();
  private nextSweepAt = 0;
  private nextCapSweepAt = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  hit(key: string, windowMs: number): RateLimitHit {
    const now = this.now();

    this.sweepIfDue(now);

    const current = this.entries.get(key);

    if (current !== undefined && current.resetAt > now) {
      current.count += 1;

      return { ...current };
    }

    // New key or expired window: start over and move the key to the newest slot.
    this.entries.delete(key);

    // At the cap every new key would otherwise scan every entry. Windows last minutes, so the scan
    // finds almost nothing and the oldest entry is evicted right after anyway: under many distinct
    // clients that is O(cap) work per request on the main thread (the load test saw the event loop
    // saturate at ~230 req/s). At most one full scan per interval; eviction alone keeps the cap.
    if (this.entries.size >= this.maxEntries && now >= this.nextCapSweepAt) {
      this.sweep(now);
      this.nextCapSweepAt = now + CAP_SWEEP_INTERVAL_MS;
    }

    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();

      if (oldest.done) {
        break;
      }

      this.entries.delete(oldest.value);
    }

    const created = { count: 1, resetAt: now + windowMs };

    this.entries.set(key, created);

    return { ...created };
  }

  reset(): void {
    this.entries.clear();
    this.nextSweepAt = 0;
    this.nextCapSweepAt = 0;
  }

  /** Number of live entries; exposed for tests of the memory bound. */
  get size(): number {
    return this.entries.size;
  }

  private sweepIfDue(now: number): void {
    if (now >= this.nextSweepAt) {
      this.sweep(now);
      this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    }
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
