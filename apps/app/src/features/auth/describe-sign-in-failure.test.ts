import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api-client";
import { describeSignInFailure } from "./describe-sign-in-failure";

describe("describeSignInFailure", () => {
  it("shows one message for bad credentials, whatever the server text says", () => {
    expect(
      describeSignInFailure(new ApiError(401, "INVALID_CREDENTIALS", "No such user ana@x.test")),
    ).toEqual({ fieldErrors: {}, general: "Invalid email or password.", unconfirmed: false });
  });

  it("flags an unconfirmed account so the page can offer the resend link", () => {
    expect(describeSignInFailure(new ApiError(403, "EMAIL_NOT_CONFIRMED", "x"))).toEqual({
      fieldErrors: {},
      general: "Confirm your email to sign in.",
      unconfirmed: true,
    });
  });

  it("says how long to wait on a rate limit, in seconds or minutes", () => {
    const seconds = new ApiError(429, "RATE_LIMITED", "x", [{ retryAfterSeconds: 30 }]);
    const minutes = new ApiError(429, "RATE_LIMITED", "x", [{ retryAfterSeconds: 540 }]);

    expect(describeSignInFailure(seconds).general).toBe(
      "Too many sign-in attempts. Try again in 30 seconds.",
    );
    expect(describeSignInFailure(minutes).general).toBe(
      "Too many sign-in attempts. Try again in 9 minutes.",
    );
    expect(describeSignInFailure(new ApiError(429, "RATE_LIMITED", "x")).general).toBe(
      "Too many sign-in attempts.",
    );
  });

  it("maps 400 field details to the form fields", () => {
    const failure = describeSignInFailure(
      new ApiError(400, "VALIDATION_FAILED", "x", [
        { field: "email", message: "Enter a valid email address." },
        { field: "unknown", message: "ignored" },
      ]),
    );

    expect(failure.fieldErrors).toEqual({ email: "Enter a valid email address." });
    expect(failure.general).toBeUndefined();
  });

  it.each([
    ["a server error", new ApiError(500, "INTERNAL_ERROR", "x")],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x")],
    ["a 400 without usable details", new ApiError(400, "VALIDATION_FAILED", "x")],
    ["a non-API error", new Error("boom")],
  ])("falls back to a general retry message for %s", (_label, error) => {
    expect(describeSignInFailure(error)).toEqual({
      fieldErrors: {},
      general: "We could not sign you in. Check your connection and try again.",
      unconfirmed: false,
    });
  });
});
