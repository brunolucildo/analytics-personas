import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-client";
import { describeResetPasswordFailure } from "./describe-reset-password-failure";

describe("describeResetPasswordFailure", () => {
  it("flags a refused link, whatever the server text says", () => {
    expect(
      describeResetPasswordFailure(new ApiError(400, "TOKEN_INVALID_OR_EXPIRED", "anything")),
    ).toEqual({ fieldErrors: {}, linkInvalid: true });
  });

  it("maps 400 field details to the form fields and ignores unknown ones", () => {
    const failure = describeResetPasswordFailure(
      new ApiError(400, "VALIDATION_FAILED", "x", [
        { field: "password", message: "Password must have between 8 and 128 characters." },
        { field: "confirmPassword", message: "Passwords do not match" },
        { field: "token", message: "Token is required." },
      ]),
    );

    expect(failure).toEqual({
      fieldErrors: {
        password: "Password must have between 8 and 128 characters.",
        confirmPassword: "Passwords do not match",
      },
      linkInvalid: false,
    });
  });

  it("says how long to wait on a rate limit, in seconds or minutes", () => {
    const seconds = new ApiError(429, "RATE_LIMITED", "x", [{ retryAfterSeconds: 30 }]);
    const minutes = new ApiError(429, "RATE_LIMITED", "x", [{ retryAfterSeconds: 540 }]);

    expect(describeResetPasswordFailure(seconds).general).toBe(
      "Too many attempts. Try again in 30 seconds.",
    );
    expect(describeResetPasswordFailure(minutes).general).toBe(
      "Too many attempts. Try again in 9 minutes.",
    );
    expect(describeResetPasswordFailure(new ApiError(429, "RATE_LIMITED", "x")).general).toBe(
      "Too many attempts.",
    );
  });

  it.each([
    ["a server error", new ApiError(500, "INTERNAL_ERROR", "x")],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x")],
    ["a 400 without usable details", new ApiError(400, "VALIDATION_FAILED", "x")],
    ["something that is not an ApiError", new Error("boom")],
  ])("falls back to a retry message for %s", (_label, error) => {
    expect(describeResetPasswordFailure(error)).toEqual({
      fieldErrors: {},
      linkInvalid: false,
      general: "We could not reset your password. Check your connection and try again.",
    });
  });
});
