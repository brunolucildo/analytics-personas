import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-client";
import { describeForgotPasswordFailure } from "./describe-forgot-password-failure";

describe("describeForgotPasswordFailure", () => {
  it("maps a 400 on the e-mail to a field error", () => {
    const error = new ApiError(400, "VALIDATION_FAILED", "Invalid.", [
      { field: "email", message: "Enter a valid email address." },
    ]);

    expect(describeForgotPasswordFailure(error)).toEqual({
      emailError: "Enter a valid email address.",
    });
  });

  it("maps a 429 to a general message with the wait time", () => {
    const error = new ApiError(429, "RATE_LIMITED", "Slow down.", [{ retryAfterSeconds: 600 }]);

    expect(describeForgotPasswordFailure(error).general).toBe(
      "Too many requests. Try again in 10 minutes.",
    );
  });

  it("omits the wait time when the API did not send it", () => {
    expect(
      describeForgotPasswordFailure(new ApiError(429, "RATE_LIMITED", "Slow down.")).general,
    ).toBe("Too many requests.");
  });

  it.each([
    ["a network error", new ApiError(0, "NETWORK_ERROR", "Could not reach the server.")],
    ["a 5xx", new ApiError(500, "INTERNAL_ERROR", "Oops.")],
    ["a 400 without a usable detail", new ApiError(400, "VALIDATION_FAILED", "Invalid.")],
    ["a non-API error", new Error("boom")],
  ])("falls back to the generic message for %s", (_label, error) => {
    expect(describeForgotPasswordFailure(error)).toEqual({
      general: "We could not send the reset link. Check your connection and try again.",
    });
  });
});
