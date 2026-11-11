import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TelemetryRecorder, startTelemetryRecorder } from "../../../../test/support/telemetry";
import { DURATION_BUCKETS_SECONDS } from "../../../observability/duration-buckets";
import { HashCapacityExceededError } from "../domain/auth-errors";
import { HashLimiter } from "./hash-limiter";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("HashLimiter", () => {
  let recorder: TelemetryRecorder;

  beforeAll(() => {
    recorder = startTelemetryRecorder();
  });

  afterAll(async () => {
    await recorder.stop();
  });

  it("never runs more hashes at the same time than the concurrency, and starts them in arrival order", async () => {
    const limiter = new HashLimiter({ concurrency: 3, maxQueue: 100 });
    const gates = Array.from({ length: 10 }, () => deferred());
    const started: number[] = [];
    let running = 0;
    let peak = 0;

    const runs = gates.map((gate, index) =>
      limiter.run(async () => {
        started.push(index);
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;

        return index;
      }),
    );

    await flush();

    expect(running).toBe(3);
    expect(limiter.activeCount).toBe(3);
    expect(limiter.queuedCount).toBe(7);

    for (const gate of gates) {
      gate.resolve();
      await flush();
    }

    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.queuedCount).toBe(0);
  });

  it("hands a finished slot straight to the next waiter, so the running count never dips", async () => {
    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 5 });
    const first = deferred();
    const second = deferred();

    const a = limiter.run(() => first.promise);
    const b = limiter.run(() => second.promise);

    await flush();
    expect(limiter.activeCount).toBe(1);
    expect(limiter.queuedCount).toBe(1);

    first.resolve();
    await flush();

    expect(limiter.activeCount).toBe(1);
    expect(limiter.queuedCount).toBe(0);

    second.resolve();
    await Promise.all([a, b]);
    expect(limiter.activeCount).toBe(0);
  });

  it("refuses with HashCapacityExceededError when the queue is full, without running the task", async () => {
    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 2 });
    const gate = deferred();
    let refusedTaskRan = false;

    const running = limiter.run(() => gate.promise);
    const queuedOne = limiter.run(() => Promise.resolve("one"));
    const queuedTwo = limiter.run(() => Promise.resolve("two"));
    const refused = limiter.run(async () => {
      refusedTaskRan = true;

      return "never";
    });

    const failure = await refused.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HashCapacityExceededError);
    expect((failure as HashCapacityExceededError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(refusedTaskRan).toBe(false);

    gate.resolve();
    await expect(Promise.all([running, queuedOne, queuedTwo])).resolves.toEqual([
      undefined,
      "one",
      "two",
    ]);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.queuedCount).toBe(0);
  });

  it("refuses at once when there is no queue at all (maxQueue 0)", async () => {
    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 0 });
    const gate = deferred();
    const running = limiter.run(() => gate.promise);

    await expect(limiter.run(() => Promise.resolve())).rejects.toBeInstanceOf(
      HashCapacityExceededError,
    );

    gate.resolve();
    await running;
  });

  it("frees the slot when a task fails, and the error reaches the caller untouched", async () => {
    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 2 });
    const failure = new Error("hash failed");
    const failing = limiter.run(() => Promise.reject(failure));
    const next = limiter.run(() => Promise.resolve("ok"));

    await expect(failing).rejects.toBe(failure);
    await expect(next).resolves.toBe("ok");
    expect(limiter.activeCount).toBe(0);
  });

  it("can take new work again after it refused some", async () => {
    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 0 });
    const gate = deferred();
    const running = limiter.run(() => gate.promise);

    await limiter.run(() => Promise.resolve()).catch(() => undefined);
    gate.resolve();
    await running;

    await expect(limiter.run(() => Promise.resolve("again"))).resolves.toBe("again");
  });

  it("estimates Retry-After from the queue and the recent hash duration, between 1 and 30 seconds", async () => {
    let clock = 0;
    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 0, now: () => clock });

    // A very slow hash pulls the running average up.
    const slow = limiter.run(async () => {
      clock += 600_000;
    });

    await slow;

    const gate = deferred();
    const running = limiter.run(() => gate.promise);
    const refused = (await limiter
      .run(() => Promise.resolve())
      .catch((e: unknown) => e)) as HashCapacityExceededError;

    expect(refused.retryAfterSeconds).toBe(30);

    gate.resolve();
    await running;
  });

  it("rejects settings that cannot work", () => {
    expect(() => new HashLimiter({ concurrency: 0, maxQueue: 1 })).toThrowError(/concurrency/);
    expect(() => new HashLimiter({ concurrency: 1.5, maxQueue: 1 })).toThrowError(/concurrency/);
    expect(() => new HashLimiter({ concurrency: 1, maxQueue: -1 })).toThrowError(/maxQueue/);
    expect(() => new HashLimiter({ concurrency: 1, maxQueue: 1.5 })).toThrowError(/maxQueue/);
  });

  it("records the wait, the rejections and the occupancy with no client data in any label", async () => {
    // Metrics are delta: drain what earlier tests left unread before starting from zero.
    for (const name of ["auth.hash.rejected", "auth.hash.queue.wait"]) await recorder.metric(name);

    recorder.reset();

    const limiter = new HashLimiter({ concurrency: 1, maxQueue: 1 });
    const gate = deferred();
    const running = limiter.run(() => gate.promise);
    const queued = limiter.run(() => Promise.resolve());

    await limiter.run(() => Promise.resolve()).catch(() => undefined);

    const midActive = await recorder.metric("auth.hash.active");
    const midQueued = await recorder.metric("auth.hash.queued");

    gate.resolve();
    await Promise.all([running, queued]);

    const rejected = await recorder.metric("auth.hash.rejected");
    const waits = await recorder.metric("auth.hash.queue.wait");

    expect(rejected.reduce((sum, point) => sum + point.value, 0)).toBe(1);
    expect(waits.reduce((sum, point) => sum + point.value, 0)).toBe(2);
    expect(waits[0]?.boundaries).toEqual(DURATION_BUCKETS_SECONDS);
    expect(midActive.length).toBeGreaterThan(0);
    expect(midQueued.length).toBeGreaterThan(0);

    for (const point of [...rejected, ...waits, ...midActive, ...midQueued]) {
      expect(point.attributes).toEqual({});
    }
  });
});
