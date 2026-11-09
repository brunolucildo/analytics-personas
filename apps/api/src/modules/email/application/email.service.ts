import { EmailDeliveryError } from "../domain/email-delivery-error";
import { DEFAULT_EMAIL_PURPOSE, type EmailMessage } from "../domain/email-message";
import type { EmailProvider } from "../domain/email-provider";

/** Structured logger port. Fields passed here must never contain PII or secrets. */
export interface EmailLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface EmailServiceOptions {
  /** Total attempts (1 + retries). */
  maxAttempts: number;
  /** Upper bound for one attempt. */
  attemptTimeoutMs: number;
  /** Upper bound for the whole delivery, waits included. */
  totalTimeoutMs: number;
  /** First wait between attempts; doubles on each retry. */
  backoffBaseMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const DEFAULT_EMAIL_SERVICE_OPTIONS: EmailServiceOptions = {
  maxAttempts: 3,
  attemptTimeoutMs: 5_000,
  totalTimeoutMs: 15_000,
  backoffBaseMs: 250,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Single exit point for transactional e-mail. Use cases call `dispatch` after
 * the transaction commits; only this service knows a provider exists.
 */
export class EmailService {
  private readonly options: EmailServiceOptions;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly provider: EmailProvider,
    private readonly logger: EmailLogger,
    options: Partial<EmailServiceOptions> = {},
  ) {
    this.options = { ...DEFAULT_EMAIL_SERVICE_OPTIONS, ...options };
  }

  /**
   * Delivers with timeout and bounded retry. Rejects with `EmailDeliveryError`
   * once the attempts are exhausted or the error is permanent.
   */
  async send(message: EmailMessage): Promise<void> {
    const startedAt = this.options.now();
    const purpose = message.purpose ?? DEFAULT_EMAIL_PURPOSE;
    let attempts = 0;

    for (;;) {
      attempts += 1;

      try {
        const remaining = this.options.totalTimeoutMs - (this.options.now() - startedAt);

        await this.attempt(message, Math.min(this.options.attemptTimeoutMs, remaining));
        this.logger.info(
          {
            event: "email_sent",
            provider: this.provider.name,
            purpose,
            durationMs: this.options.now() - startedAt,
            attempts,
          },
          "email_sent",
        );
        return;
      } catch (caught) {
        const error = toDeliveryError(caught).withAttempts(attempts);
        const backoff = this.options.backoffBaseMs * 2 ** (attempts - 1);
        const elapsed = this.options.now() - startedAt;
        const canRetry =
          error.retryable &&
          attempts < this.options.maxAttempts &&
          elapsed + backoff < this.options.totalTimeoutMs;

        if (!canRetry) {
          this.logger.error(
            {
              event: "email_delivery_failed",
              provider: this.provider.name,
              purpose,
              durationMs: elapsed,
              attempts,
              errorCode: error.code,
            },
            "email_delivery_failed",
          );
          throw error;
        }

        await this.options.sleep(backoff);
      }
    }
  }

  /**
   * Fire-and-forget delivery: resolves right away and never rejects, so the
   * calling request neither waits for the attempts nor fails with them. The
   * failure is logged by `send`.
   */
  dispatch(message: EmailMessage): Promise<void> {
    const delivery = this.send(message).then(
      () => undefined,
      () => undefined,
    );

    this.inFlight.add(delivery);
    void delivery.finally(() => this.inFlight.delete(delivery));

    return Promise.resolve();
  }

  /** Waits for deliveries started by `dispatch` (tests and graceful shutdown). */
  async drain(): Promise<void> {
    await Promise.all(this.inFlight);
  }

  private async attempt(message: EmailMessage, timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new EmailDeliveryError("TIMEOUT", true));
      }, timeoutMs);
    });

    try {
      await Promise.race([this.provider.deliver(message, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function toDeliveryError(caught: unknown): EmailDeliveryError {
  if (caught instanceof EmailDeliveryError) {
    return caught;
  }

  // Unknown failures (for example a provider bug or a dropped socket) are
  // treated as transient network errors; the cause is deliberately not kept.
  return new EmailDeliveryError("NETWORK_ERROR", true);
}
