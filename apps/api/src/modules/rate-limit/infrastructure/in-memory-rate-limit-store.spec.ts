import { describe, expect, it, vi } from "vitest";
import { InMemoryRateLimitStore } from "./in-memory-rate-limit-store";

function createClock(start = 1_000_000) {
  let current = start;

  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("InMemoryRateLimitStore", () => {
  it("counts hits of the same key inside one window", () => {
    const clock = createClock();
    const store = new InMemoryRateLimitStore(clock.now);

    expect(store.hit("a", 60_000).count).toBe(1);
    expect(store.hit("a", 60_000).count).toBe(2);
    expect(store.hit("a", 60_000).count).toBe(3);
  });

  it("keeps keys independent", () => {
    const store = new InMemoryRateLimitStore(createClock().now);

    store.hit("a", 60_000);
    store.hit("a", 60_000);

    expect(store.hit("b", 60_000).count).toBe(1);
  });

  it("reports when the window ends and keeps that instant fixed while counting", () => {
    const clock = createClock(5_000);
    const store = new InMemoryRateLimitStore(clock.now);

    expect(store.hit("a", 60_000).resetAt).toBe(65_000);

    clock.advance(10_000);

    expect(store.hit("a", 60_000)).toEqual({ count: 2, resetAt: 65_000 });
  });

  it("restarts the count when the window has ended", () => {
    const clock = createClock();
    const store = new InMemoryRateLimitStore(clock.now);

    store.hit("a", 60_000);
    store.hit("a", 60_000);
    clock.advance(60_000);

    expect(store.hit("a", 60_000)).toEqual({ count: 1, resetAt: clock.now() + 60_000 });
  });

  it("drops expired entries instead of keeping them forever", () => {
    const clock = createClock();
    const store = new InMemoryRateLimitStore(clock.now);

    for (let index = 0; index < 50; index += 1) {
      store.hit(`key-${index}`, 1_000);
    }

    expect(store.size).toBe(50);

    clock.advance(120_000);
    store.hit("fresh", 1_000);

    expect(store.size).toBe(1);
  });

  it("never holds more entries than the cap, evicting the oldest first", () => {
    const store = new InMemoryRateLimitStore(createClock().now, 3);

    store.hit("first", 60_000);
    store.hit("second", 60_000);
    store.hit("third", 60_000);
    store.hit("fourth", 60_000);

    expect(store.size).toBe(3);
    // "first" was evicted, so it starts again at 1; "second" is still counted.
    expect(store.hit("second", 60_000).count).toBe(2);
    expect(store.hit("first", 60_000).count).toBe(1);
    expect(store.size).toBe(3);
  });

  it("stays under the cap with many distinct keys", () => {
    const store = new InMemoryRateLimitStore(createClock().now, 100);

    for (let index = 0; index < 1_000; index += 1) {
      store.hit(`key-${index}`, 60_000);
    }

    expect(store.size).toBe(100);
  });

  it("still clears expired entries at the cap once the scan interval has passed", () => {
    const clock = createClock();
    const store = new InMemoryRateLimitStore(clock.now, 3);

    store.hit("a", 1_000);
    store.hit("b", 1_000);
    store.hit("c", 1_000);
    clock.advance(5_000);
    store.hit("d", 60_000);

    expect(store.size).toBe(1);
  });

  it("does not scan every entry for each new key at the cap", () => {
    const clock = createClock();
    const store = new InMemoryRateLimitStore(clock.now, 1_000);

    for (let index = 0; index < 1_000; index += 1) {
      store.hit(`warm-${index}`, 60_000);
    }

    // A full scan iterates the map; count how many happen for 500 new keys at the cap.
    const iterate = vi.spyOn(Map.prototype, Symbol.iterator);

    for (let index = 0; index < 500; index += 1) {
      store.hit(`new-${index}`, 60_000);
    }

    const scans = iterate.mock.calls.length;

    iterate.mockRestore();

    expect(scans).toBeLessThanOrEqual(1);
    expect(store.size).toBe(1_000);

    // After the interval the scan is allowed again.
    clock.advance(1_000);
    store.hit("later", 60_000);
  });

  it("forgets everything on reset", () => {
    const store = new InMemoryRateLimitStore(createClock().now);

    store.hit("a", 60_000);
    store.hit("a", 60_000);
    store.reset();

    expect(store.size).toBe(0);
    expect(store.hit("a", 60_000).count).toBe(1);
  });
});
