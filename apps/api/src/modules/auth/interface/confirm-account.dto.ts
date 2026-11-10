import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/** Longest token the endpoint will hash; real tokens have 43 characters. */
const TOKEN_MAX = 512;

/** Body of `POST /api/v1/auth/confirm-account`. Unknown properties are rejected by the global pipe. */
export class ConfirmAccountDto {
  @IsString({ message: "Token must be text." })
  @IsNotEmpty({ message: "Token is required." })
  @MaxLength(TOKEN_MAX, { message: `Token must have at most ${TOKEN_MAX} characters.` })
  token!: string;
}
