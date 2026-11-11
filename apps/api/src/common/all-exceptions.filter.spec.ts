import type { ArgumentsHost } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseLogger } from "../observability/logger";
import { ApiException } from "./api-exception";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { ServiceBusyException } from "./service-busy.exception";

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const setHeader = vi.fn();
  const response = { locals: {} as Record<string, unknown>, status, setHeader };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ id: "req-1" }) }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);

  return { status, json, setHeader, response };
}

describe("AllExceptionsFilter", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(baseLogger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers a busy service with 503, Retry-After and the envelope, and does not log a crash", () => {
    const { status, json, setHeader, response } = run(new ServiceBusyException(7));

    expect(status).toHaveBeenCalledWith(503);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", 7);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "SERVICE_BUSY",
        message: "The service is busy right now. Try again shortly.",
        details: [{ retryAfterSeconds: 7 }],
      },
    });
    expect(response.locals.errorCode).toBe("SERVICE_BUSY");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not log any deliberate ApiException as an unhandled exception", () => {
    run(new ApiException(503, "SOMETHING_DOWN", "Down."));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("still logs an unexpected error as unhandled and answers 500 without detail", () => {
    const { status, json } = run(new Error("secret detail"));

    expect(status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls)).not.toContain("secret detail");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-1" }),
      "unhandled_exception",
    );
  });

  it("does not set Retry-After for other errors", () => {
    const { setHeader } = run(new ApiException(409, "CONFLICT", "Conflict."));

    expect(setHeader).not.toHaveBeenCalled();
  });
});
