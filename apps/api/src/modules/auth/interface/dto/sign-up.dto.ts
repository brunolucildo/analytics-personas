import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, MaxLength } from "class-validator";
import { AUTH_LIMITS, normalizeEmail, normalizeName } from "../../domain/auth-rules";
import { SameAs } from "../same-as.decorator";

const trimName = ({ value }: { value: unknown }) =>
  typeof value === "string" ? normalizeName(value) : value;
const normalizeEmailInput = ({ value }: { value: unknown }) =>
  typeof value === "string" ? normalizeEmail(value) : value;

/** Body of `POST /api/v1/auth/sign-up`. Unknown properties are rejected by the global pipe. */
export class SignUpDto {
  @Transform(trimName)
  @IsString({ message: "First name must be text." })
  @Length(AUTH_LIMITS.nameMin, AUTH_LIMITS.nameMax, {
    message: `First name must have between ${AUTH_LIMITS.nameMin} and ${AUTH_LIMITS.nameMax} characters.`,
  })
  firstName!: string;

  @Transform(trimName)
  @IsString({ message: "Last name must be text." })
  @Length(AUTH_LIMITS.nameMin, AUTH_LIMITS.nameMax, {
    message: `Last name must have between ${AUTH_LIMITS.nameMin} and ${AUTH_LIMITS.nameMax} characters.`,
  })
  lastName!: string;

  @Transform(normalizeEmailInput)
  @IsString({ message: "Email must be text." })
  @MaxLength(AUTH_LIMITS.emailMax, {
    message: `Email must have at most ${AUTH_LIMITS.emailMax} characters.`,
  })
  @IsEmail({}, { message: "Enter a valid email address." })
  email!: string;

  @IsString({ message: "Password must be text." })
  @Length(AUTH_LIMITS.passwordMin, AUTH_LIMITS.passwordMax, {
    message: `Password must have between ${AUTH_LIMITS.passwordMin} and ${AUTH_LIMITS.passwordMax} characters.`,
  })
  password!: string;

  @IsString({ message: "Confirm password must be text." })
  @SameAs("password", { message: "Passwords do not match" })
  confirmPassword!: string;
}
