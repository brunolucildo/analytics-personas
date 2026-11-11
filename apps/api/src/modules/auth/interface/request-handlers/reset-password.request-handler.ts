import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../../common/api-exception";
import { Public } from "../../../../common/public.decorator";
import { ServiceBusyException } from "../../../../common/service-busy.exception";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { ResetPassword } from "../../application/use-cases/reset-password.use-case";
import {
  HashCapacityExceededError,
  InvalidPasswordResetTokenError,
} from "../../domain/auth-errors";
import { ResetPasswordDto } from "../dto/reset-password.dto";

@Controller("auth")
export class ResetPasswordRequestHandler {
  constructor(@Inject(ResetPassword) private readonly resetPassword: ResetPassword) {}

  /**
   * Sets a new password with the link token: 204 and no session (the person signs in next).
   * The DTO is validated before the token is touched, so a rejected password does not use the
   * link up. One answer for every bad token (unknown, expired, used, wrong type). Every session
   * of the user is revoked in the same transaction that changes the password.
   */
  @Post("reset-password")
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit("reset-password")
  async handle(@Body() body: ResetPasswordDto): Promise<void> {
    await traceAuthOperation("reset_password", async () => {
      try {
        await this.resetPassword.execute({ token: body.token, password: body.password });
      } catch (error) {
        if (error instanceof InvalidPasswordResetTokenError) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "TOKEN_INVALID_OR_EXPIRED",
            "This link is invalid or has expired.",
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
