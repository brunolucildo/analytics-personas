import { describe, expect, it } from "vitest";
import { describeResendConfirmationFailure } from "./describe-resend-confirmation-failure";
import { validateResendConfirmation } from "./resend-confirmation-validation";
import { ApiError } from "../../lib/api-client";

describe("validateResendConfirmation", () => {
  it("accepts a valid e-mail, ignoring surrounding spaces", () => {
    expect(validateResendConfirmation({ email: "  ana@example.test " })).toEqual({});
  });

  it.each(["", "   ", "ana", "ana@", "@example.test", "ana@example", "ana @example.test"])(
    "rejects %j",
    (email) => {
      expect(validateResendConfirmation({ email })).toEqual({
        email: "Enter a valid email address.",
      });
    },
  );

  it("rejects an e-mail over 254 characters", () => {
    expect(validateResendConfirmation({ email: `${"a".repeat(250)}@example.test` }).email).toBe(
      "Email must have at most 254 characters.",
    );
  });
});

describe("describeResendConfirmationFailure", () => {
  it("maps a 400 on the e-mail to a field error", () => {
    const error = new ApiError(400, "VALIDATION_FAILED", "Invalid.", [
      { field: "email", message: "Enter a valid email address." },
    ]);

    expect(describeResendConfirmationFailure(error)).toEqual({
      emailError: "Enter a valid email address.",
    });
  });

  it("maps a 429 to a general message with the wait time", () => {
    const error = new ApiError(429, "RATE_LIMITED", "Slow down.", [{ retryAfterSeconds: 600 }]);

    expect(describeResendConfirmationFailure(error).general).toBe(
      "Too many requests. Try again in 10 minutes.",
    );
  });

  it("omits the wait time when the API did not send it", () => {
    expect(
      describeResendConfirmationFailure(new ApiError(429, "RATE_LIMITED", "Slow down.")).general,
    ).toBe("Too many requests.");
  });

  it.each([
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "Could not reach the server.")],
    ["a server error", new ApiError(500, "INTERNAL_ERROR", "Boom.")],
    ["a non-API error", new Error("boom")],
  ])("falls back to the generic message for %s", (_label, error) => {
    expect(describeResendConfirmationFailure(error).general).toBe(
      "We could not send the link. Check your connection and try again.",
    );
  });
});
