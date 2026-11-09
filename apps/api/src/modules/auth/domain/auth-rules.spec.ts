import { describe, expect, it } from "vitest";
import {
  AUTH_LIMITS,
  CONFIRMATION_TOKEN_TTL_MS,
  isNameLengthValid,
  isPasswordLengthValid,
  normalizeEmail,
  normalizeName,
} from "./auth-rules";

describe("normalizeEmail", () => {
  it("trims and lower-cases the address", () => {
    expect(normalizeEmail("  Ana@Example.COM \n")).toBe("ana@example.com");
  });

  it("makes equivalent addresses equal", () => {
    expect(normalizeEmail("Ana@Example.com")).toBe(normalizeEmail(" ana@example.com"));
  });
});

describe("normalizeName", () => {
  it("trims surrounding whitespace and keeps the inner text and case", () => {
    expect(normalizeName("  Maria  Clara ")).toBe("Maria  Clara");
  });
});

describe("isNameLengthValid", () => {
  it.each([
    ["", false],
    ["A", true],
    ["a".repeat(AUTH_LIMITS.nameMax), true],
    ["a".repeat(AUTH_LIMITS.nameMax + 1), false],
  ])("%j -> %s", (value, expected) => {
    expect(isNameLengthValid(value)).toBe(expected);
  });
});

describe("isPasswordLengthValid", () => {
  it.each([
    [7, false],
    [8, true],
    [128, true],
    [129, false],
  ])("a password of %i characters -> %s", (length, expected) => {
    expect(isPasswordLengthValid("x".repeat(length))).toBe(expected);
  });

  it("does not require any composition (letters, digits, symbols)", () => {
    expect(isPasswordLengthValid("        ")).toBe(true);
    expect(isPasswordLengthValid("aaaaaaaa")).toBe(true);
  });
});

describe("limits", () => {
  it("keeps the e-mail limit at 254 characters and the confirmation token at 24 hours", () => {
    expect(AUTH_LIMITS.emailMax).toBe(254);
    expect(CONFIRMATION_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
