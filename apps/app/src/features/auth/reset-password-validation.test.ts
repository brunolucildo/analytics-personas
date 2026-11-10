import { describe, expect, it } from "vitest";
import { validateResetPassword } from "./reset-password-validation";

describe("validateResetPassword", () => {
  it("accepts matching passwords of 8 to 128 characters", () => {
    expect(validateResetPassword({ password: "12345678", confirmPassword: "12345678" })).toEqual(
      {},
    );

    const long = "x".repeat(128);

    expect(validateResetPassword({ password: long, confirmPassword: long })).toEqual({});
  });

  it.each([
    ["too short", "1234567"],
    ["empty", ""],
    ["too long", "x".repeat(129)],
  ])("rejects a password that is %s", (_label, password) => {
    expect(validateResetPassword({ password, confirmPassword: password }).password).toBe(
      "Password must have between 8 and 128 characters.",
    );
  });

  it("rejects a confirmation that differs, with the agreed message", () => {
    expect(validateResetPassword({ password: "12345678", confirmPassword: "12345679" })).toEqual({
      confirmPassword: "Passwords do not match",
    });
  });

  it("does not trim: spaces count", () => {
    expect(validateResetPassword({ password: "       a", confirmPassword: "       a" })).toEqual(
      {},
    );
  });
});
