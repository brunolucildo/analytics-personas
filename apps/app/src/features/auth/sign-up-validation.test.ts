import { describe, expect, it } from "vitest";
import { validateSignUp, type SignUpValues } from "./sign-up-validation";

const VALID: SignUpValues = {
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
  password: "correct horse battery",
  confirmPassword: "correct horse battery",
};

describe("validateSignUp", () => {
  it("accepts valid values", () => {
    expect(validateSignUp(VALID)).toEqual({});
  });

  it("treats names made only of spaces as empty", () => {
    expect(Object.keys(validateSignUp({ ...VALID, firstName: "   ", lastName: "" }))).toEqual([
      "firstName",
      "lastName",
    ]);
  });

  it("rejects names over 100 characters", () => {
    expect(validateSignUp({ ...VALID, lastName: "x".repeat(101) }).lastName).toBe(
      "Last name must have between 1 and 100 characters.",
    );
  });

  it.each(["ana", "ana@", "@example.test", "ana@example", "ana @example.test"])(
    "rejects the e-mail %j",
    (email) => {
      expect(validateSignUp({ ...VALID, email }).email).toBe("Enter a valid email address.");
    },
  );

  it("rejects an e-mail longer than 254 characters", () => {
    expect(validateSignUp({ ...VALID, email: `${"a".repeat(250)}@example.test` }).email).toBe(
      "Email must have at most 254 characters.",
    );
  });

  it.each([7, 129])("rejects a password of %i characters", (length) => {
    const password = "p".repeat(length);

    expect(validateSignUp({ ...VALID, password, confirmPassword: password }).password).toBe(
      "Password must have between 8 and 128 characters.",
    );
  });

  it("asks the confirmation to match the password", () => {
    expect(validateSignUp({ ...VALID, confirmPassword: "different" })).toEqual({
      confirmPassword: "Passwords do not match",
    });
  });
});
