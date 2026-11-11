import { EventEmitter } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type TelemetryRecorder, startTelemetryRecorder } from "../../../../test/support/telemetry";
import { rememberErrorCode } from "../../../common/error-code";
import { authOperationOf, createAuthTelemetryMiddleware } from "./auth-telemetry.middleware";

const PREFIX = "api/v1";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  locals: Record<string, unknown> = {};
}

describe("authOperationOf", () => {
  it.each([
    ["/api/v1/auth/sign-up", "sign_up"],
    ["/api/v1/auth/confirm-account", "confirm_account"],
    ["/api/v1/auth/sign-in", "sign_in"],
    ["/api/v1/auth/sign-out", "sign_out"],
    ["/api/v1/auth/forgot-password", "forgot_password"],
    ["/api/v1/auth/reset-password", "reset_password"],
    ["/api/v1/auth/resend-confirmation", "resend_confirmation"],
    ["/api/v1/auth/sign-in/", "sign_in"],
  ])("maps POST %s to %s", (path, operation) => {
    expect(authOperationOf("POST", path, PREFIX)).toBe(operation);
  });

  it.each([
    ["GET", "/api/v1/auth/sign-in"],
    ["POST", "/api/v1/auth/session"],
    ["POST", "/api/v1/health"],
    ["POST", "/api/v1/auth/"],
    ["POST", "/api/v1/auth/sign-in/extra"],
    ["POST", "/auth/sign-in"],
    ["POST", "/api/v1/auth/constructor"],
    ["POST", "/"],
  ])("ignores %s %s", (method, path) => {
    expect(authOperationOf(method, path, PREFIX)).toBeUndefined();
  });
});

describe("createAuthTelemetryMiddleware", () => {
  let recorder: TelemetryRecorder;
  const logger = { info: vi.fn(), warn: vi.fn() };
  const middleware = createAuthTelemetryMiddleware({ prefix: PREFIX, logger });

  /** Runs one request through the middleware and finishes the response. */
  function attempt(
    method: string,
    path: string,
    outcome: { status: number; code?: string },
    id: unknown = "req-1",
  ): void {
    const response = new FakeResponse();
    const next = vi.fn();

    middleware({ method, path, id }, response, next);
    expect(next).toHaveBeenCalledOnce();

    response.statusCode = outcome.status;

    if (outcome.code !== undefined) {
      rememberErrorCode(response, outcome.code);
    }

    response.emit("finish");
  }

  beforeAll(() => {
    recorder = startTelemetryRecorder();
  });

  afterAll(async () => {
    await recorder.stop();
  });

  beforeEach(() => {
    recorder.reset();
    logger.info.mockReset();
    logger.warn.mockReset();
  });

  it("counts a successful attempt, times it and logs it at info level", async () => {
    attempt("POST", "/api/v1/auth/sign-in", { status: 200 });

    expect(await recorder.metric("auth.operations")).toEqual([
      { attributes: { operation: "sign_in", outcome: "success", reason: "none" }, value: 1 },
    ]);
    expect(await recorder.metric("auth.operation.duration")).toMatchObject([
      { attributes: { operation: "sign_in", outcome: "success" }, value: 1 },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: "auth_operation",
        operation: "sign_in",
        outcome: "success",
        reason: "none",
        requestId: "req-1",
      },
      "auth_operation",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["sign_in", "/api/v1/auth/sign-in", 401, "INVALID_CREDENTIALS", "invalid_credentials"],
    ["sign_in", "/api/v1/auth/sign-in", 403, "EMAIL_NOT_CONFIRMED", "email_not_confirmed"],
    [
      "sign_up",
      "/api/v1/auth/sign-up",
      409,
      "EMAIL_ALREADY_REGISTERED",
      "email_already_registered",
    ],
    ["sign_up", "/api/v1/auth/sign-up", 400, "VALIDATION_FAILED", "validation_failed"],
    ["sign_in", "/api/v1/auth/sign-in", 429, "RATE_LIMITED", "rate_limited"],
    ["sign_out", "/api/v1/auth/sign-out", 401, "UNAUTHENTICATED", "unauthenticated"],
    [
      "reset_password",
      "/api/v1/auth/reset-password",
      400,
      "TOKEN_INVALID_OR_EXPIRED",
      "token_invalid_or_expired",
    ],
    ["confirm_account", "/api/v1/auth/confirm-account", 500, "INTERNAL_ERROR", "internal_error"],
  ])(
    "counts %s %s -> %s as a failure with reason %s",
    async (operation, path, status, code, reason) => {
      attempt("POST", path, { status, code });

      expect(await recorder.metric("auth.operations")).toEqual([
        { attributes: { operation, outcome: "failure", reason }, value: 1 },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: "auth_operation", operation, outcome: "failure", reason }),
        "auth_operation",
      );
    },
  );

  it("falls back to the status when no error code was recorded (errors outside the filter)", async () => {
    attempt("POST", "/api/v1/auth/sign-up", { status: 413 });
    attempt("POST", "/api/v1/auth/sign-up", { status: 400 });

    const points = await recorder.metric("auth.operations");

    expect(points.map((point) => point.attributes.reason).sort()).toEqual([
      "request_failed",
      "validation_failed",
    ]);
  });

  it("never lets a reason outside the closed set reach the metric", async () => {
    attempt("POST", "/api/v1/auth/sign-in", { status: 400, code: "ana@example.com" });

    expect(await recorder.metric("auth.operations")).toEqual([
      {
        attributes: { operation: "sign_in", outcome: "failure", reason: "request_failed" },
        value: 1,
      },
    ]);
  });

  it("ignores requests that are not authentication endpoints", async () => {
    attempt("GET", "/api/v1/health", { status: 200 });
    attempt("GET", "/api/v1/auth/session", { status: 200 });
    attempt("POST", "/api/v1/auth/unknown", { status: 404 });

    expect(await recorder.metric("auth.operations")).toEqual([]);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs nothing but the closed fields and the request id", () => {
    attempt("POST", "/api/v1/auth/forgot-password", { status: 202 });

    const [fields] = logger.info.mock.calls[0] as [Record<string, unknown>];

    expect(Object.keys(fields).sort()).toEqual([
      "event",
      "operation",
      "outcome",
      "reason",
      "requestId",
    ]);
  });

  it("omits the request id when it is not a string", () => {
    attempt("POST", "/api/v1/auth/sign-out", { status: 204 }, null);

    const [fields] = logger.info.mock.calls[0] as [Record<string, unknown>];

    expect(fields).not.toHaveProperty("requestId");
  });

  it("does not throw out of the response when the logger fails", () => {
    logger.info.mockImplementationOnce(() => {
      throw new Error("log sink is down");
    });

    expect(() => attempt("POST", "/api/v1/auth/sign-in", { status: 200 })).not.toThrow();
  });
});
