import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../common/api-exception";
import { Public } from "../../../common/public.decorator";
import { RateLimit } from "../../rate-limit";
import { ConfirmAccount } from "../application/confirm-account";
import { RequestPasswordReset } from "../application/request-password-reset";
import { ResendConfirmation } from "../application/resend-confirmation";
import { SignUp } from "../application/sign-up";
import { EmailAlreadyRegisteredError, InvalidConfirmationTokenError } from "../domain/auth-errors";
import { ConfirmAccountDto } from "./confirm-account.dto";
import { ResendConfirmationDto } from "./resend-confirmation.dto";
import { ForgotPasswordDto } from "./forgot-password.dto";
import type { ActiveSession } from "../domain/session-ports";
import { CurrentSession } from "./current-session.decorator";
import {
  presentSession,
  presentUser,
  type SessionResponse,
  type UserResponse,
} from "./session.presenter";
import { SignUpDto } from "./sign-up.dto";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(SignUp) private readonly signUp: SignUp,
    @Inject(RequestPasswordReset) private readonly requestPasswordReset: RequestPasswordReset,
    @Inject(ConfirmAccount) private readonly confirmAccountUseCase: ConfirmAccount,
    @Inject(ResendConfirmation) private readonly resendConfirmationUseCase: ResendConfirmation,
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

  /**
   * Confirms the e-mail behind the link token and opens the session. One answer for
   * every bad token (unknown, expired, used, wrong type): the reason is not told.
   */
  @Post("confirm-account")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit("confirm-account")
  async confirmAccount(@Body() body: ConfirmAccountDto): Promise<SessionResponse> {
    try {
      return presentSession(await this.confirmAccountUseCase.execute({ token: body.token }));
    } catch (error) {
      if (error instanceof InvalidConfirmationTokenError) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "TOKEN_INVALID_OR_EXPIRED",
          "This link is invalid or has expired.",
        );
      }

      throw error;
    }
  }

  /**
   * Always answers 202 `{}`, whether the e-mail has an unconfirmed account, a
   * confirmed one or none: the body, the status and the (background) mail delivery
   * keep the route from revealing which addresses are registered.
   */
  @Post("resend-confirmation")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit("resend-confirmation")
  async resendConfirmation(@Body() body: ResendConfirmationDto): Promise<Record<string, never>> {
    await this.resendConfirmationUseCase.execute({ email: body.email });

    return {};
  }

  /** The user behind the current session (the guard already validated it). */
  @Get("session")
  getSession(@CurrentSession() session: ActiveSession): { user: UserResponse } {
    return { user: presentUser(session.user) };
  }
}
