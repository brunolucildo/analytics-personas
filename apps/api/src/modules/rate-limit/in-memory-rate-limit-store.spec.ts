import { describe, expect, it } from "vitest";
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

  it("forgets everything on reset", () => {
    const store = new InMemoryRateLimitStore(createClock().now);

    store.hit("a", 60_000);
    store.hit("a", 60_000);
    store.reset();

    expect(store.size).toBe(0);
    expect(store.hit("a", 60_000).count).toBe(1);
  });
});
