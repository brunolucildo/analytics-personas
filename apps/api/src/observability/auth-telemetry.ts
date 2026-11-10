import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { ApiException } from "../common/api-exception";

/** Every authentication operation that has telemetry (the `operation` label and span suffix). */
export const AUTH_OPERATIONS = [
  "sign_up",
  "confirm_account",
  "sign_in",
  "sign_out",
  "forgot_password",
  "reset_password",
  "resend_confirmation",
] as const;

export type AuthOperation = (typeof AUTH_OPERATIONS)[number];

/**
 * Closed set of failure reasons: the `code` of the error envelope in lower case. Anything else
 * collapses into `request_failed`, so the label never takes a value the client controls.
 */
export const AUTH_FAILURE_REASONS = [
  "validation_failed",
  "rate_limited",
  "unauthenticated",
  "email_already_registered",
  "invalid_credentials",
  "email_not_confirmed",
  "token_invalid_or_expired",
  "internal_error",
  "request_failed",
] as const;

export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number];
export type AuthReason = AuthFailureReason | "none";
export type AuthOutcome = "success" | "failure";

const KNOWN_REASONS: ReadonlySet<string> = new Set(AUTH_FAILURE_REASONS);

/** The `reason` of a failed attempt, from the envelope `code` when there is one, else the status. */
export function reasonOf(statusCode: number, errorCode?: string): AuthFailureReason {
  if (errorCode !== undefined) {
    const reason = errorCode.toLowerCase();

    return KNOWN_REASONS.has(reason) ? (reason as AuthFailureReason) : "request_failed";
  }

  if (statusCode >= 500) {
    return "internal_error";
  }

  switch (statusCode) {
    case 400:
      return "validation_failed";
    case 401:
      return "unauthenticated";
    case 429:
      return "rate_limited";
    default:
      return "request_failed";
  }
}

const METER_NAME = "rondo-api";

function createInstruments() {
  const meter = metrics.getMeter(METER_NAME);

  return {
    operations: meter.createCounter("auth.operations", {
      description: "Authentication attempts by operation, outcome and failure reason.",
      unit: "{operation}",
    }),
    duration: meter.createHistogram("auth.operation.duration", {
      description: "Time to answer an authentication request.",
      unit: "s",
    }),
  };
}

let instruments: ReturnType<typeof createInstruments> | undefined;

// Created on first use: the API meter provider is only registered when the SDK starts.
function getInstruments() {
  instruments ??= createInstruments();

  return instruments;
}

export interface AuthAttempt {
  operation: AuthOperation;
  outcome: AuthOutcome;
  reason: AuthReason;
  durationSeconds: number;
}

/** Counts one attempt and records how long it took. Labels are the closed sets above, never input. */
export function recordAuthAttempt(attempt: AuthAttempt): void {
  const { operations, duration } = getInstruments();

  operations.add(1, {
    operation: attempt.operation,
    outcome: attempt.outcome,
    reason: attempt.reason,
  });
  duration.record(attempt.durationSeconds, {
    operation: attempt.operation,
    outcome: attempt.outcome,
  });
}

function errorCodeOf(error: unknown): string {
  return error instanceof ApiException ? error.code : "INTERNAL_ERROR";
}

/**
 * Runs one authentication operation inside the span `auth.<operation>`, a child of the HTTP span.
 * On failure the span gets status `ERROR` and only the error code: no exception message, stack or
 * event, since those can carry personal data. The error is rethrown untouched.
 */
export async function traceAuthOperation<T>(
  operation: AuthOperation,
  run: () => Promise<T>,
): Promise<T> {
  return trace
    .getTracer(METER_NAME)
    .startActiveSpan(
      `auth.${operation}`,
      { attributes: { "auth.operation": operation } },
      async (span) => {
        try {
          const result = await run();

          span.setAttribute("auth.outcome", "success");

          return result;
        } catch (error) {
          span.setAttribute("auth.outcome", "failure");
          span.setAttribute("auth.error_code", errorCodeOf(error));
          span.setStatus({ code: SpanStatusCode.ERROR });

          throw error;
        } finally {
          span.end();
        }
      },
    );
}
