import { IsNotEmpty, IsString, Length, MaxLength } from "class-validator";
import { AUTH_LIMITS } from "../../domain/auth-rules";
import { SameAs } from "../same-as.decorator";

/** Longest token the endpoint will hash; real tokens have 43 characters. */
const TOKEN_MAX = 512;

/** Body of `POST /api/v1/auth/reset-password`. Unknown properties are rejected by the global pipe. */
export class ResetPasswordDto {
  @IsString({ message: "Token must be text." })
  @IsNotEmpty({ message: "Token is required." })
  @MaxLength(TOKEN_MAX, { message: `Token must have at most ${TOKEN_MAX} characters.` })
  token!: string;

  @IsString({ message: "Password must be text." })
  @Length(AUTH_LIMITS.passwordMin, AUTH_LIMITS.passwordMax, {
    message: `Password must have between ${AUTH_LIMITS.passwordMin} and ${AUTH_LIMITS.passwordMax} characters.`,
  })
  password!: string;

  @IsString({ message: "Confirm password must be text." })
  @SameAs("password", { message: "Passwords do not match" })
  confirmPassword!: string;
}
