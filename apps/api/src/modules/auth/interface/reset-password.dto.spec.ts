import { ValidationPipe } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiException } from "../../../common/api-exception";
import { createValidationException } from "../../../common/validation-exception";
import { ResetPasswordDto } from "./reset-password.dto";

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
        metatype: ResetPasswordDto,
      })) as unknown,
    };
  } catch (error) {
    if (error instanceof ApiException) {
      return { details: error.details };
    }

    throw error;
  }
}

const VALID = { token: "abc", password: "12345678", confirmPassword: "12345678" };

describe("ResetPasswordDto", () => {
  it("accepts a token and matching passwords of 8 to 128 characters", async () => {
    expect((await validate(VALID)).value).toMatchObject(VALID);

    const long = "x".repeat(128);

    expect(
      (await validate({ ...VALID, password: long, confirmPassword: long })).value,
    ).toBeDefined();
  });

  it.each([
    ["a missing token", { password: "12345678", confirmPassword: "12345678" }],
    ["an empty token", { ...VALID, token: "" }],
    ["a token over 512 characters", { ...VALID, token: "a".repeat(513) }],
    ["a missing password", { token: "abc", confirmPassword: "12345678" }],
    [
      "a password under 8 characters",
      { ...VALID, password: "1234567", confirmPassword: "1234567" },
    ],
    [
      "a password over 128 characters",
      { ...VALID, password: "x".repeat(129), confirmPassword: "x".repeat(129) },
    ],
    ["a missing confirmation", { token: "abc", password: "12345678" }],
    ["an extra field", { ...VALID, isAdmin: true }],
  ])("rejects %s", async (_label, body) => {
    expect((await validate(body)).details).toBeDefined();
  });

  it("reports a mismatch on confirmPassword with the agreed message", async () => {
    const outcome = await validate({ ...VALID, confirmPassword: "different1" });

    expect(outcome.details).toEqual([
      expect.objectContaining({ field: "confirmPassword", message: "Passwords do not match" }),
    ]);
  });
});
