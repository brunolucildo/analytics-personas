import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiException } from "../../../common/api-exception";
import { createValidationException } from "../../../common/validation-exception";
import { SignUpDto } from "./sign-up.dto";

const VALID = {
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
  password: "correct horse battery",
  confirmPassword: "correct horse battery",
};

// Same options as `configureApp`, so the DTO is checked the way the API runs it.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: createValidationException,
});

async function validate(body: Record<string, unknown>) {
  try {
    return {
      value: (await pipe.transform(body, { type: "body", metatype: SignUpDto })) as SignUpDto,
    };
  } catch (error) {
    if (error instanceof ApiException) {
      return { details: error.details };
    }

    throw error;
  }
}

async function failingFields(body: Record<string, unknown>) {
  const result = await validate(body);

  return [...new Set((result.details ?? []).map((detail) => detail.field))].sort();
}

describe("SignUpDto", () => {
  it("accepts a valid body and normalizes names and e-mail", async () => {
    const result = await validate({
      ...VALID,
      firstName: "  Ana ",
      lastName: " Silva  ",
      email: "  Ana@Example.TEST ",
    });

    expect(result.details).toBeUndefined();
    expect(result.value).toMatchObject({
      firstName: "Ana",
      lastName: "Silva",
      email: "ana@example.test",
    });
  });

  it("keeps the password exactly as typed (no trimming)", async () => {
    const result = await validate({
      ...VALID,
      password: "  spaced pass  ",
      confirmPassword: "  spaced pass  ",
    });

    expect(result.value?.password).toBe("  spaced pass  ");
  });

  it.each([
    ["an empty first name", { firstName: "" }, "firstName"],
    ["a blank first name", { firstName: "   " }, "firstName"],
    ["a first name over 100 characters", { firstName: "a".repeat(101) }, "firstName"],
    ["an empty last name", { lastName: "" }, "lastName"],
    ["a last name over 100 characters", { lastName: "b".repeat(101) }, "lastName"],
    ["an invalid e-mail", { email: "not-an-email" }, "email"],
    ["an e-mail over 254 characters", { email: `${"a".repeat(250)}@example.test` }, "email"],
    ["a password under 8 characters", { password: "short", confirmPassword: "short" }, "password"],
    [
      "a password over 128 characters",
      { password: "p".repeat(129), confirmPassword: "p".repeat(129) },
      "password",
    ],
    ["a missing first name", { firstName: undefined }, "firstName"],
    ["a non-string e-mail", { email: 42 }, "email"],
  ])("rejects %s with the field named", async (_label, override, field) => {
    expect(await failingFields({ ...VALID, ...override })).toContain(field);
  });

  it("reports confirmPassword with the 'Passwords do not match' message", async () => {
    const result = await validate({ ...VALID, confirmPassword: "something else entirely" });

    expect(result.details).toEqual([
      { field: "confirmPassword", message: "Passwords do not match" },
    ]);
  });

  it("rejects fields that are not part of the contract", async () => {
    const result = await validate({ ...VALID, role: "admin" });

    expect(result.details).toEqual([{ field: "role", message: "property role should not exist" }]);
  });
});
