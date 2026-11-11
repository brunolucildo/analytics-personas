import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength } from "class-validator";
import { AUTH_LIMITS, normalizeEmail } from "../../domain/auth-rules";

const normalizeEmailInput = ({ value }: { value: unknown }) =>
  typeof value === "string" ? normalizeEmail(value) : value;

/** Body of `POST /api/v1/auth/resend-confirmation`. Unknown properties are rejected by the global pipe. */
export class ResendConfirmationDto {
  @Transform(normalizeEmailInput)
  @IsString({ message: "Email must be text." })
  @MaxLength(AUTH_LIMITS.emailMax, {
    message: `Email must have at most ${AUTH_LIMITS.emailMax} characters.`,
  })
  @IsEmail({}, { message: "Enter a valid email address." })
  email!: string;
}
