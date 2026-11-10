import { describe, expect, it } from "vitest";
import { validateForgotPassword } from "./forgot-password-validation";

describe("validateForgotPassword", () => {
  it("accepts a valid e-mail, ignoring surrounding spaces", () => {
    expect(validateForgotPassword({ email: "  ana@example.test " })).toEqual({});
  });

  it.each(["", "   ", "ana", "ana@", "@example.test", "ana@example", "ana @example.test"])(
    "rejects %j",
    (email) => {
      expect(validateForgotPassword({ email })).toEqual({
        email: "Enter a valid email address.",
      });
    },
  );

  it("rejects an e-mail over 254 characters", () => {
    expect(validateForgotPassword({ email: `${"a".repeat(250)}@example.test` }).email).toBe(
      "Email must have at most 254 characters.",
    );
  });
});
