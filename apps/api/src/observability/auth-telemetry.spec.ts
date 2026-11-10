import { HttpStatus } from "@nestjs/common";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TelemetryRecorder, startTelemetryRecorder } from "../../test/support/telemetry";
import { ApiException } from "../common/api-exception";
import {
  AUTH_FAILURE_REASONS,
  recordAuthAttempt,
  reasonOf,
  traceAuthOperation,
} from "./auth-telemetry";

describe("reasonOf", () => {
  it("lowers the envelope code when it is part of the closed set", () => {
    expect(reasonOf(401, "INVALID_CREDENTIALS")).toBe("invalid_credentials");
    expect(reasonOf(409, "EMAIL_ALREADY_REGISTERED")).toBe("email_already_registered");
    expect(reasonOf(400, "TOKEN_INVALID_OR_EXPIRED")).toBe("token_invalid_or_expired");
    expect(reasonOf(403, "EMAIL_NOT_CONFIRMED")).toBe("email_not_confirmed");
    expect(reasonOf(400, "VALIDATION_FAILED")).toBe("validation_failed");
    expect(reasonOf(429, "RATE_LIMITED")).toBe("rate_limited");
    expect(reasonOf(401, "UNAUTHENTICATED")).toBe("unauthenticated");
    expect(reasonOf(500, "INTERNAL_ERROR")).toBe("internal_error");
  });

  it("collapses any other code into request_failed", () => {
    expect(reasonOf(403, "FORBIDDEN")).toBe("request_failed");
    expect(reasonOf(404, "NOT_FOUND")).toBe("request_failed");
    expect(reasonOf(413, "REQUEST_FAILED")).toBe("request_failed");
    expect(reasonOf(400, "user@example.com")).toBe("request_failed");
  });

  it("derives the reason from the status when no code was recorded", () => {
    expect(reasonOf(400)).toBe("validation_failed");
    expect(reasonOf(401)).toBe("unauthenticated");
    expect(reasonOf(429)).toBe("rate_limited");
    expect(reasonOf(413)).toBe("request_failed");
    expect(reasonOf(502)).toBe("internal_error");
  });

  it("never returns a value outside the closed set", () => {
    for (const [status, code] of [
      [400, undefined],
      [418, "TEAPOT"],
      [500, "boom"],
      [200, undefined],
    ] as const) {
      expect(AUTH_FAILURE_REASONS).toContain(reasonOf(status, code));
    }
  });
});

describe("auth telemetry instruments", () => {
  let recorder: TelemetryRecorder;

  beforeAll(() => {
    recorder = startTelemetryRecorder();
  });

  afterAll(async () => {
    await recorder.stop();
  });

  beforeEach(() => {
    recorder.reset();
  });

  describe("recordAuthAttempt", () => {
    it("counts the attempt by operation, outcome and reason, and times it", async () => {
      recordAuthAttempt({
        operation: "sign_in",
        outcome: "failure",
        reason: "invalid_credentials",
        durationSeconds: 0.25,
      });
      recordAuthAttempt({
        operation: "sign_in",
        outcome: "success",
        reason: "none",
        durationSeconds: 0.1,
      });

      expect(await recorder.metric("auth.operations")).toEqual(
        expect.arrayContaining([
          {
            attributes: { operation: "sign_in", outcome: "failure", reason: "invalid_credentials" },
            value: 1,
          },
          { attributes: { operation: "sign_in", outcome: "success", reason: "none" }, value: 1 },
        ]),
      );

      const durations = await recorder.metric("auth.operation.duration");

      expect(durations).toHaveLength(2);
      expect(durations.find((point) => point.attributes.outcome === "failure")).toMatchObject({
        attributes: { operation: "sign_in", outcome: "failure" },
        value: 1,
        sum: 0.25,
      });
    });
  });

  describe("traceAuthOperation", () => {
    it("wraps a successful run in auth.<operation> as a child of the active span", async () => {
      const tracer = trace.getTracer("test");
      const result = await tracer.startActiveSpan("POST /api/v1/auth/sign-up", async (parent) => {
        const value = await traceAuthOperation("sign_up", async () => "done");

        parent.end();

        return value;
      });

      expect(result).toBe("done");

      const spans = recorder.spans();
      const child = spans.find((span) => span.name === "auth.sign_up");
      const parent = spans.find((span) => span.name === "POST /api/v1/auth/sign-up");

      expect(child?.attributes).toEqual({
        "auth.operation": "sign_up",
        "auth.outcome": "success",
      });
      expect(child?.status.code).toBe(SpanStatusCode.UNSET);
      expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
    });

    it("marks a failure as ERROR with only the error code and rethrows the same error", async () => {
      const failure = new ApiException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_CREDENTIALS",
        "Invalid email or password for ana@example.com.",
      );

      await expect(
        traceAuthOperation("sign_in", async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);

      const span = recorder.spans().find((item) => item.name === "auth.sign_in");

      expect(span?.attributes).toEqual({
        "auth.operation": "sign_in",
        "auth.outcome": "failure",
        "auth.error_code": "INVALID_CREDENTIALS",
      });
      expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
      expect(span?.events).toEqual([]);
      expect(JSON.stringify(recorder.exportedSpans())).not.toContain("ana@example.com");
    });

    it("reports INTERNAL_ERROR for an unexpected error without leaking its message", async () => {
      await expect(
        traceAuthOperation("reset_password", async () => {
          throw new Error("duplicate key value violates constraint for ana@example.com");
        }),
      ).rejects.toThrow("duplicate key");

      const span = recorder.spans().find((item) => item.name === "auth.reset_password");

      expect(span?.attributes["auth.error_code"]).toBe("INTERNAL_ERROR");
      expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
      expect(JSON.stringify(recorder.exportedSpans())).not.toContain("ana@example.com");
    });
  });
});
