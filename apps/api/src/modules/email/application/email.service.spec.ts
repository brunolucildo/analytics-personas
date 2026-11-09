import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryError } from "../domain/email-delivery-error";
import type { EmailMessage } from "../domain/email-message";
import type { EmailProvider } from "../domain/email-provider";
import { type EmailLogger, EmailService } from "./email.service";

const message: EmailMessage = {
  to: "pat.example@secret-recipient.test",
  subject: "Confirm your account SECRET-SUBJECT",
  text: "Open https://app.test/auth/confirm?token=SECRET-TOKEN",
  html: "<p>Open https://app.test/auth/confirm?token=SECRET-TOKEN</p>",
  purpose: "sign_up_confirmation",
};

interface LogEntry {
  level: "info" | "error";
  fields: Record<string, unknown>;
  message: string;
}

function createLogger(): EmailLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];

  return {
    entries,
    info: (fields, text) => entries.push({ level: "info", fields, message: text }),
    error: (fields, text) => entries.push({ level: "error", fields, message: text }),
  };
}

function createProvider(
  behaviour: (message: EmailMessage, signal: AbortSignal, call: number) => Promise<void>,
): EmailProvider & { calls: number } {
  const provider = {
    name: "fake",
    calls: 0,
    deliver(input: EmailMessage, signal: AbortSignal) {
      provider.calls += 1;
      return behaviour(input, signal, provider.calls);
    },
  };

  return provider;
}

const instantSleep = () => Promise.resolve();

afterEach(() => {
  vi.useRealTimers();
});

describe("EmailService.send", () => {
  it("hands the message to the provider and logs email_sent without PII", async () => {
    const received: EmailMessage[] = [];
    const provider = createProvider(async (input) => {
      received.push(input);
    });
    const logger = createLogger();
    const service = new EmailService(provider, logger, { sleep: instantSleep });

    await service.send(message);

    expect(received).toEqual([message]);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.fields).toMatchObject({
      event: "email_sent",
      provider: "fake",
      purpose: "sign_up_confirmation",
      attempts: 1,
    });
    expect(typeof logger.entries[0]?.fields.durationMs).toBe("number");
  });

  it("retries a transient error and succeeds on the second attempt", async () => {
    const provider = createProvider(async (_input, _signal, call) => {
      if (call === 1) {
        throw new EmailDeliveryError("PROVIDER_UNAVAILABLE", true);
      }
    });
    const sleeps: number[] = [];
    const service = new EmailService(provider, createLogger(), {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await service.send(message);

    expect(provider.calls).toBe(2);
    expect(sleeps).toEqual([250]);
  });

  it("stops after 3 attempts with growing waits and rejects with EmailDeliveryError", async () => {
    const provider = createProvider(async () => {
      throw new EmailDeliveryError("PROVIDER_UNAVAILABLE", true);
    });
    const sleeps: number[] = [];
    const logger = createLogger();
    const service = new EmailService(provider, logger, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    const failure = await service.send(message).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE", attempts: 3 });
    expect(provider.calls).toBe(3);
    expect(sleeps).toEqual([250, 500]);
    expect(logger.entries.at(-1)?.fields).toMatchObject({
      event: "email_delivery_failed",
      errorCode: "PROVIDER_UNAVAILABLE",
      attempts: 3,
    });
  });

  it("does not retry a permanent error", async () => {
    const provider = createProvider(async () => {
      throw new EmailDeliveryError("PROVIDER_REJECTED", false);
    });
    const service = new EmailService(provider, createLogger(), { sleep: instantSleep });

    await expect(service.send(message)).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
      retryable: false,
      attempts: 1,
    });
    expect(provider.calls).toBe(1);
  });

  it("treats an unknown provider failure as a transient network error without keeping its message", async () => {
    const provider = createProvider(async () => {
      throw new Error("socket hang up for pat.example@secret-recipient.test");
    });
    const service = new EmailService(provider, createLogger(), { sleep: instantSleep });

    const failure = await service.send(message).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "NETWORK_ERROR", retryable: true, attempts: 3 });
    expect((failure as Error).message).not.toContain("secret-recipient");
  });

  it("times out a provider that never answers: 3 attempts and a failure within 15 s", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const provider = createProvider((_input, signal) => {
      signals.push(signal);
      return new Promise<void>(() => undefined);
    });
    const logger = createLogger();
    const service = new EmailService(provider, logger);
    const startedAt = Date.now();

    const outcome = service.send(message).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(15_000);
    const failure = await outcome;

    expect(failure).toMatchObject({ code: "TIMEOUT", attempts: 3 });
    expect(provider.calls).toBe(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(15_000);
  });

  it("gives each attempt at most 5 s", async () => {
    vi.useFakeTimers();
    const provider = createProvider(() => new Promise<void>(() => undefined));
    const service = new EmailService(provider, createLogger(), { maxAttempts: 1 });

    const outcome = service.send(message).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(provider.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: "TIMEOUT", attempts: 1 });
  });

  it("never logs the recipient, subject, body, token or link", async () => {
    const failing = createProvider(async () => {
      throw new EmailDeliveryError("PROVIDER_UNAUTHORIZED", false);
    });
    const working = createProvider(async () => undefined);
    const logger = createLogger();

    await new EmailService(working, logger, { sleep: instantSleep }).send(message);
    await new EmailService(failing, logger, { sleep: instantSleep })
      .send(message)
      .catch(() => undefined);

    const logged = JSON.stringify(logger.entries);

    expect(logger.entries).toHaveLength(2);
    for (const secret of ["secret-recipient", "SECRET-SUBJECT", "SECRET-TOKEN", "app.test"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("EmailService.dispatch", () => {
  it("resolves without error and logs the failure when the provider is down", async () => {
    const provider = createProvider(async () => {
      throw new EmailDeliveryError("PROVIDER_UNAVAILABLE", true);
    });
    const logger = createLogger();
    const service = new EmailService(provider, logger, { sleep: instantSleep });

    await expect(service.dispatch(message)).resolves.toBeUndefined();
    await service.drain();

    expect(logger.entries.at(-1)?.fields).toMatchObject({ event: "email_delivery_failed" });
  });

  it("does not make the caller wait for the delivery attempts", async () => {
    let finish: () => void = () => undefined;
    const provider = createProvider(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const logger = createLogger();
    const service = new EmailService(provider, logger);

    await service.dispatch(message);

    expect(logger.entries).toHaveLength(0);

    finish();
    await service.drain();

    expect(logger.entries[0]?.fields).toMatchObject({ event: "email_sent" });
  });
});
