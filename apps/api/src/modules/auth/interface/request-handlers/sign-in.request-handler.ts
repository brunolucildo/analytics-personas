import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../../common/api-exception";
import { Public } from "../../../../common/public.decorator";
import { ServiceBusyException } from "../../../../common/service-busy.exception";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { SignIn } from "../../application/use-cases/sign-in.use-case";
import {
  EmailNotConfirmedError,
  HashCapacityExceededError,
  InvalidCredentialsError,
} from "../../domain/auth-errors";
import { SignInDto } from "../dto/sign-in.dto";
import { presentSession, type SessionResponse } from "../presenters/session.presenter";

@Controller("auth")
export class SignInRequestHandler {
  constructor(@Inject(SignIn) private readonly signIn: SignIn) {}

  /**
   * Opens a session with e-mail and password. A missing account and a wrong password end the
   * same way (401 `INVALID_CREDENTIALS`); the account is only said to be unconfirmed (403) to
   * someone who proved they know the password. A new session revokes the previous one.
   */
  @Post("sign-in")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit("sign-in-ip", "sign-in")
  async handle(@Body() body: SignInDto): Promise<SessionResponse> {
    return traceAuthOperation("sign_in", async () => {
      try {
        return presentSession(
          await this.signIn.execute({ email: body.email, password: body.password }),
        );
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          throw new ApiException(
            HttpStatus.UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "Invalid email or password.",
          );
        }

        if (error instanceof EmailNotConfirmedError) {
          throw new ApiException(
            HttpStatus.FORBIDDEN,
            "EMAIL_NOT_CONFIRMED",
            "Confirm your email to sign in.",
          );
        }

        if (error instanceof HashCapacityExceededError) {
          throw new ServiceBusyException(error.retryAfterSeconds);
        }

        throw error;
      }
    });
  }
}
