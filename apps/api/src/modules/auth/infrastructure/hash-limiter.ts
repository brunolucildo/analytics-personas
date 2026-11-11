import { type ObservableResult, metrics } from "@opentelemetry/api";
import { ServiceBusyException } from "../../../common/service-busy.exception";
import { DURATION_BUCKETS_SECONDS } from "../../../observability/duration-buckets";

/** Runs one password-hashing task under the hash budget. */
export interface HashRunner {
  run<T>(task: () => Promise<T>): Promise<T>;
}

/** No limit: for unit tests of the code that only needs the adapter to call the library. */
export const UNLIMITED_HASH_RUNNER: HashRunner = { run: (task) => task() };

export interface HashLimiterOptions {
  /** Hashes allowed at the same time. Keep it below the libuv thread pool size (default 4). */
  concurrency: number;
  /** Hashes allowed to wait for a free slot; one more is refused with 503. */
  maxQueue: number;
  now?: () => number;
}

interface Waiter {
  start(): void;
}

const METER_NAME = "rondo-api";
const MIN_RETRY_AFTER_SECONDS = 1;
const MAX_RETRY_AFTER_SECONDS = 30;
/** Weight of the latest hash duration in the running average (used only to estimate Retry-After). */
const AVERAGE_WEIGHT = 0.2;
const INITIAL_AVERAGE_MS = 100;

const limiters = new Set<HashLimiter>();
let instruments: ReturnType<typeof createInstruments> | undefined;

function createInstruments() {
  const meter = metrics.getMeter(METER_NAME);
  const active = meter.createObservableGauge("auth.hash.active", {
    description: "Password hashes running now.",
    unit: "{hash}",
  });
  const queued = meter.createObservableGauge("auth.hash.queued", {
    description: "Password hashes waiting for a free slot.",
    unit: "{hash}",
  });

  const sum = (read: (limiter: HashLimiter) => number) => (result: ObservableResult) => {
    let total = 0;

    for (const limiter of limiters) total += read(limiter);

    result.observe(total);
  };

  active.addCallback(sum((limiter) => limiter.activeCount));
  queued.addCallback(sum((limiter) => limiter.queuedCount));

  return {
    wait: meter.createHistogram("auth.hash.queue.wait", {
      description: "Time a password hash waited for a free slot.",
      unit: "s",
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
    }),
    rejected: meter.createCounter("auth.hash.rejected", {
      description: "Password hashes refused because the queue was full.",
      unit: "{hash}",
    }),
  };
}

// Created on first use: the API meter provider is only registered when the SDK starts.
function getInstruments() {
  instruments ??= createInstruments();

  return instruments;
}

/**
 * Argon2 is memory-bound and runs in the libuv thread pool, which the JWT check, `randomBytes` and
 * the calls to PostgREST share: past the machine's ceiling (about 33 hashes per second on the
 * development machine) the pool queue grows and every one of them waits behind the hashes. This
 * keeps fewer hashes in flight than there are pool threads, queues the rest in arrival order and,
 * when the queue is full, refuses at once with 503 instead of making everyone wait.
 * Nothing about the password, the account or the client is stored or recorded.
 */
export class HashLimiter implements HashRunner {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  private averageMs = INITIAL_AVERAGE_MS;
  private readonly now: () => number;
  private readonly concurrency: number;
  private readonly maxQueue: number;

  constructor(options: HashLimiterOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error("HashLimiter concurrency must be an integer of at least 1.");
    }

    if (!Number.isInteger(options.maxQueue) || options.maxQueue < 0) {
      throw new Error("HashLimiter maxQueue must be an integer of at least 0.");
    }

    this.concurrency = options.concurrency;
    this.maxQueue = options.maxQueue;
    this.now = options.now ?? (() => performance.now());
    limiters.add(this);
    getInstruments();
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();

    const startedAt = this.now();

    try {
      return await task();
    } finally {
      this.averageMs += AVERAGE_WEIGHT * (this.now() - startedAt - this.averageMs);
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      this.recordWait(0);

      return Promise.resolve();
    }

    if (this.waiting.length >= this.maxQueue) {
      this.safely(() => getInstruments().rejected.add(1));

      return Promise.reject(new ServiceBusyException(this.retryAfterSeconds()));
    }

    return new Promise<void>((resolve) => {
      const enqueuedAt = this.now();

      this.waiting.push({
        start: () => {
          this.recordWait((this.now() - enqueuedAt) / 1000);
          resolve();
        },
      });
    });
  }

  /** Hands the slot straight to the next waiter (the count of running hashes does not change). */
  private release(): void {
    const next = this.waiting.shift();

    if (next === undefined) {
      this.active -= 1;

      return;
    }

    next.start();
  }

  /** How long the queue ahead of a new request takes to drain, from the recent hash duration. */
  private retryAfterSeconds(): number {
    const seconds = Math.ceil(
      ((this.waiting.length + 1) * this.averageMs) / this.concurrency / 1000,
    );

    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(MIN_RETRY_AFTER_SECONDS, seconds));
  }

  private recordWait(seconds: number): void {
    this.safely(() => getInstruments().wait.record(seconds));
  }

  private safely(record: () => void): void {
    try {
      record();
    } catch {
      // Telemetry must never take a request down.
    }
  }
}
