import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../common/api-exception";
import { Public } from "../../../common/public.decorator";
import { RateLimit } from "../../rate-limit";
import { RequestPasswordReset } from "../application/request-password-reset";
import { SignUp } from "../application/sign-up";
import { EmailAlreadyRegisteredError } from "../domain/auth-errors";
import { ForgotPasswordDto } from "./forgot-password.dto";
import type { ActiveSession } from "../domain/session-ports";
import { CurrentSession } from "./current-session.decorator";
import { presentUser, type UserResponse } from "./session.presenter";
import { SignUpDto } from "./sign-up.dto";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(SignUp) private readonly signUp: SignUp,
    @Inject(RequestPasswordReset) private readonly requestPasswordReset: RequestPasswordReset,
  ) {}

  @Post("sign-up")
  @Public()
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

  /**
   * Always answers 202 `{}`, whether the e-mail has a confirmed account, an
   * unconfirmed one or none: the body, the status and the (background) mail
   * delivery keep the route from revealing which addresses are registered.
   */
  @Post("forgot-password")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit("forgot-password")
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<Record<string, never>> {
    await this.requestPasswordReset.execute({ email: body.email });

    return {};
  }

  /** The user behind the current session (the guard already validated it). */
  @Get("session")
  getSession(@CurrentSession() session: ActiveSession): { user: UserResponse } {
    return { user: presentUser(session.user) };
  }
}
