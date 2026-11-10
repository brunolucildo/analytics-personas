import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiException } from "../../../common/api-exception";
import { createValidationException } from "../../../common/validation-exception";
import { ForgotPasswordDto } from "./forgot-password.dto";

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
      value: (await pipe.transform(body, {
        type: "body",
        metatype: ForgotPasswordDto,
      })) as ForgotPasswordDto,
    };
  } catch (error) {
    if (error instanceof ApiException) {
      return { details: error.details };
    }

    throw error;
  }
}

describe("ForgotPasswordDto", () => {
  it("trims and lower-cases the e-mail", async () => {
    expect((await validate({ email: "  Ana@Example.TEST " })).value?.email).toBe(
      "ana@example.test",
    );
  });

  it.each([
    ["a missing e-mail", {}],
    ["an invalid e-mail", { email: "ana-at-example" }],
    ["a non-text e-mail", { email: 42 }],
    ["an e-mail over 254 characters", { email: `${"a".repeat(250)}@example.test` }],
    ["an extra field", { email: "ana@example.test", isAdmin: true }],
  ])("rejects %s", async (_label, body) => {
    const result = await validate(body);

    expect(result.value).toBeUndefined();
    expect(result.details?.length).toBeGreaterThan(0);
  });
});
