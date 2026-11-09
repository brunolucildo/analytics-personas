import { describe, expect, it } from "vitest";
import { EMPTY_SIGN_IN_VALUES, validateSignIn } from "./sign-in-validation";

describe("validateSignIn", () => {
  it("accepts a valid e-mail (surrounding spaces ignored) and any non-empty password", () => {
    expect(validateSignIn({ email: "  ana@example.test ", password: "abc" })).toEqual({});
  });

  it("asks for both fields when empty", () => {
    expect(validateSignIn(EMPTY_SIGN_IN_VALUES)).toEqual({
      email: "Enter a valid email address.",
      password: "Enter your password.",
    });
  });

  it.each(["ana", "ana@", "@example.test", "ana@example", "a na@example.test"])(
    "rejects the malformed e-mail %j",
    (email) => {
      expect(validateSignIn({ email, password: "secret-password" }).email).toBe(
        "Enter a valid email address.",
      );
    },
  );

  it("rejects an e-mail over 254 characters", () => {
    expect(validateSignIn({ email: `${"a".repeat(250)}@example.test`, password: "x" }).email).toBe(
      "Email must have at most 254 characters.",
    );
  });

  it("rejects a password over 128 characters but not a short one", () => {
    expect(validateSignIn({ email: "ana@example.test", password: "a".repeat(129) }).password).toBe(
      "Password must have at most 128 characters.",
    );
    expect(validateSignIn({ email: "ana@example.test", password: "a" }).password).toBeUndefined();
  });

  it("does not trim the password", () => {
    expect(validateSignIn({ email: "ana@example.test", password: "   " }).password).toBeUndefined();
  });
});
