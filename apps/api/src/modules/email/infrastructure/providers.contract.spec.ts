import { describe, expect, it } from "vitest";
import { type EmailLogger, EmailService } from "../application/email.service";
import { EmailDeliveryError } from "../domain/email-delivery-error";
import type { EmailMessage } from "../domain/email-message";
import type { EmailProvider } from "../domain/email-provider";
import type { FetchFunction } from "./http-delivery";
import { MailtrapEmailProvider } from "./mailtrap/mailtrap-email-provider";
import { ResendEmailProvider } from "./resend/resend-email-provider";

const from = { name: "Analytics Personas", address: "no-reply@analytics-personas.local" };
const message: EmailMessage = {
  to: "pat@example.test",
  subject: "Welcome <b>aboard</b>",
  text: "Plain body",
  html: "<p>HTML body</p>",
  purpose: "contract_test",
};

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(statuses: Array<number | "network-error" | "hang">) {
  const requests: RecordedRequest[] = [];
  const fetchFunction: FetchFunction = (url, init) => {
    requests.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = statuses[Math.min(requests.length - 1, statuses.length - 1)];

    if (next === "network-error") {
      return Promise.reject(new TypeError("fetch failed"));
    }

    if (next === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }

    return Promise.resolve(new Response('{"echo":"pat@example.test"}', { status: next }));
  };

  return { requests, fetchFunction };
}

const providers: Array<{
  name: string;
  create: (fetchFunction: FetchFunction) => EmailProvider;
  expectedUrl: string;
  expectedAuth: string;
  expectedBody: Record<string, unknown>;
}> = [
  {
    name: "mailtrap",
    create: (fetchFunction) =>
      new MailtrapEmailProvider({ apiToken: "mt-token", inboxId: "4242", from }, fetchFunction),
    expectedUrl: "https://sandbox.api.mailtrap.io/api/send/4242",
    expectedAuth: "Bearer mt-token",
    expectedBody: {
      from: { email: "no-reply@analytics-personas.local", name: "Analytics Personas" },
      to: [{ email: "pat@example.test" }],
      subject: "Welcome <b>aboard</b>",
      text: "Plain body",
      html: "<p>HTML body</p>",
    },
  },
  {
    name: "resend",
    create: (fetchFunction) => new ResendEmailProvider({ apiKey: "rs-key", from }, fetchFunction),
    expectedUrl: "https://api.resend.com/emails",
    expectedAuth: "Bearer rs-key",
    expectedBody: {
      from: "Analytics Personas <no-reply@analytics-personas.local>",
      to: ["pat@example.test"],
      subject: "Welcome <b>aboard</b>",
      text: "Plain body",
      html: "<p>HTML body</p>",
    },
  },
];

function silentLogger(): EmailLogger & { lines: string[] } {
  const lines: string[] = [];

  return {
    lines,
    info: (fields) => lines.push(JSON.stringify(fields)),
    error: (fields) => lines.push(JSON.stringify(fields)),
  };
}

describe.each(providers)("$name provider contract", (spec) => {
  const signal = new AbortController().signal;

  it("sends sender, recipient, subject, text and html unchanged and resolves on success", async () => {
    const { requests, fetchFunction } = fakeFetch([200]);

    await expect(spec.create(fetchFunction).deliver(message, signal)).resolves.toBeUndefined();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(spec.expectedUrl);
    expect(requests[0]?.headers.Authorization).toBe(spec.expectedAuth);
    expect(requests[0]?.body).toEqual(spec.expectedBody);
  });

  it.each([
    [400, "PROVIDER_REJECTED", false],
    [422, "PROVIDER_REJECTED", false],
    [401, "PROVIDER_UNAUTHORIZED", false],
    [403, "PROVIDER_UNAUTHORIZED", false],
    [429, "RATE_LIMITED", true],
    [500, "PROVIDER_UNAVAILABLE", true],
    [503, "PROVIDER_UNAVAILABLE", true],
  ] as const)(
    "rejects an HTTP %i with EmailDeliveryError %s (retryable: %s)",
    async (status, code, retryable) => {
      const { fetchFunction } = fakeFetch([status]);

      const failure = await spec
        .create(fetchFunction)
        .deliver(message, signal)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(EmailDeliveryError);
      expect(failure).toMatchObject({ code, retryable });
      expect((failure as Error).message).not.toContain("pat@example.test");
    },
  );

  it("rejects a network failure as a retryable NETWORK_ERROR", async () => {
    const { fetchFunction } = fakeFetch(["network-error"]);

    await expect(spec.create(fetchFunction).deliver(message, signal)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });

  it("rejects with TIMEOUT when the signal aborts the request", async () => {
    const { fetchFunction } = fakeFetch(["hang"]);
    const controller = new AbortController();
    const delivery = spec
      .create(fetchFunction)
      .deliver(message, controller.signal)
      .catch((error: unknown) => error);

    controller.abort();

    expect(await delivery).toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("through EmailService: retries a 5xx up to 3 attempts, then fails", async () => {
    const { requests, fetchFunction } = fakeFetch([503]);
    const service = new EmailService(spec.create(fetchFunction), silentLogger(), {
      sleep: () => Promise.resolve(),
    });

    await expect(service.send(message)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      attempts: 3,
    });
    expect(requests).toHaveLength(3);
  });

  it("through EmailService: recovers when a retry succeeds", async () => {
    const { requests, fetchFunction } = fakeFetch([500, 200]);
    const service = new EmailService(spec.create(fetchFunction), silentLogger(), {
      sleep: () => Promise.resolve(),
    });

    await expect(service.send(message)).resolves.toBeUndefined();
    expect(requests).toHaveLength(2);
  });

  it("through EmailService: a 4xx invalid request is tried once", async () => {
    const { requests, fetchFunction } = fakeFetch([422]);
    const logger = silentLogger();
    const service = new EmailService(spec.create(fetchFunction), logger, {
      sleep: () => Promise.resolve(),
    });

    await expect(service.send(message)).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect(requests).toHaveLength(1);
    expect(logger.lines.join("")).not.toMatch(/pat@example|rs-key|mt-token|Welcome/);
  });
});
