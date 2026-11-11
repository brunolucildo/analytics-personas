import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiException } from "../../../../common/api-exception";
import { createValidationException } from "../../../../common/validation-exception";
import { ConfirmAccountDto } from "./confirm-account.dto";
import { ResendConfirmationDto } from "./resend-confirmation.dto";

// Same options as `configureApp`, so the DTOs are checked the way the API runs them.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: createValidationException,
});

async function validate(metatype: new () => object, body: unknown) {
  try {
    return { value: (await pipe.transform(body, { type: "body", metatype })) as unknown };
  } catch (error) {
    if (error instanceof ApiException) {
      return { details: error.details };
    }

    throw error;
  }
}

describe("ConfirmAccountDto", () => {
  it("accepts a token", async () => {
    expect((await validate(ConfirmAccountDto, { token: "abc" })).value).toMatchObject({
      token: "abc",
    });
  });

  it.each([
    ["a missing token", {}],
    ["an empty token", { token: "" }],
    ["a non-text token", { token: 7 }],
    ["a token over 512 characters", { token: "a".repeat(513) }],
    ["an extra field", { token: "abc", isAdmin: true }],
  ])("rejects %s", async (_label, body) => {
    expect((await validate(ConfirmAccountDto, body)).details).toBeDefined();
  });

  it("reports the token as the failing field", async () => {
    const outcome = await validate(ConfirmAccountDto, {});

    expect(outcome.details?.[0]).toMatchObject({ field: "token" });
  });
});

describe("ResendConfirmationDto", () => {
  it("trims and lower-cases the e-mail", async () => {
    expect(
      (await validate(ResendConfirmationDto, { email: "  Ana@Example.TEST " })).value,
    ).toMatchObject({ email: "ana@example.test" });
  });

  it.each([
    ["a missing e-mail", {}],
    ["a malformed e-mail", { email: "ana-at-example" }],
    ["a non-text e-mail", { email: 7 }],
    ["an e-mail over 254 characters", { email: `${"a".repeat(250)}@example.test` }],
    ["an extra field", { email: "ana@example.test", isAdmin: true }],
  ])("rejects %s", async (_label, body) => {
    expect((await validate(ResendConfirmationDto, body)).details).toBeDefined();
  });
});
