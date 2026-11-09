import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiException } from "../../../common/api-exception";
import { createValidationException } from "../../../common/validation-exception";
import { SignInDto } from "./sign-in.dto";

// Same options as `configureApp`, so the DTO is checked the way the API runs it.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: createValidationException,
});

async function validate(body: unknown) {
  try {
    return {
      value: (await pipe.transform(body, { type: "body", metatype: SignInDto })) as SignInDto,
    };
  } catch (error) {
    if (error instanceof ApiException) {
      return { details: error.details };
    }

    throw error;
  }
}

describe("SignInDto", () => {
  it("trims and lower-cases the e-mail and keeps the password untouched", async () => {
    const { value } = await validate({ email: "  Ana@Example.TEST ", password: " pass word " });

    expect(value?.email).toBe("ana@example.test");
    expect(value?.password).toBe(" pass word ");
  });

  it("accepts a short password: it is just a wrong password, not a validation error", async () => {
    expect((await validate({ email: "ana@example.test", password: "abc" })).value).toBeDefined();
  });

  it.each([
    ["a missing e-mail", { password: "secret-password" }],
    ["a missing password", { email: "ana@example.test" }],
    ["an invalid e-mail", { email: "ana-at-example", password: "secret-password" }],
    ["a non-text password", { email: "ana@example.test", password: 12345678 }],
    ["an empty password", { email: "ana@example.test", password: "" }],
    ["a password over 128 characters", { email: "ana@example.test", password: "a".repeat(129) }],
    ["an extra field", { email: "ana@example.test", password: "secret-password", isAdmin: true }],
  ])("rejects %s", async (_label, body) => {
    const result = await validate(body);

    expect(result.value).toBeUndefined();
    expect(result.details?.length).toBeGreaterThan(0);
  });
});
