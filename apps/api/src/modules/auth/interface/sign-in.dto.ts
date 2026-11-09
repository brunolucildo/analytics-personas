import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { AUTH_LIMITS, normalizeEmail } from "../domain/auth-rules";

const normalizeEmailInput = ({ value }: { value: unknown }) =>
  typeof value === "string" ? normalizeEmail(value) : value;

/**
 * Body of `POST /api/v1/auth/sign-in`. Unknown properties are rejected by the global pipe.
 * The password is not checked against the sign-up length rules: a short one is simply a
 * wrong password (401). The ceiling only keeps a huge input away from the hash.
 */
export class SignInDto {
  @Transform(normalizeEmailInput)
  @IsString({ message: "Email must be text." })
  @MaxLength(AUTH_LIMITS.emailMax, {
    message: `Email must have at most ${AUTH_LIMITS.emailMax} characters.`,
  })
  @IsEmail({}, { message: "Enter a valid email address." })
  email!: string;

  @IsString({ message: "Password must be text." })
  @IsNotEmpty({ message: "Enter your password." })
  @MaxLength(AUTH_LIMITS.passwordMax, {
    message: `Password must have at most ${AUTH_LIMITS.passwordMax} characters.`,
  })
  password!: string;
}
