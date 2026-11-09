import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../common/api-exception";
import { RateLimit } from "../../rate-limit";
import { SignUp } from "../application/sign-up";
import { EmailAlreadyRegisteredError } from "../domain/auth-errors";
import { SignUpDto } from "./sign-up.dto";

@Controller("auth")
export class AuthController {
  constructor(@Inject(SignUp) private readonly signUp: SignUp) {}

  @Post("sign-up")
  @HttpCode(HttpStatus.CREATED)
  @RateLimit("sign-up")
  async signUpAccount(@Body() body: SignUpDto): Promise<{ email: string }> {
    try {
      return await this.signUp.execute({
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        password: body.password,
      });
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists.",
          [{ field: "email", message: "An account with this email already exists." }],
        );
      }

      throw error;
    }
  }
}
