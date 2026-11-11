import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../../common/api-exception";
import { Public } from "../../../../common/public.decorator";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { ConfirmAccount } from "../../application/use-cases/confirm-account.use-case";
import { InvalidConfirmationTokenError } from "../../domain/auth-errors";
import { ConfirmAccountDto } from "../dto/confirm-account.dto";
import { presentSession, type SessionResponse } from "../presenters/session.presenter";

@Controller("auth")
export class ConfirmAccountRequestHandler {
  constructor(@Inject(ConfirmAccount) private readonly confirmAccount: ConfirmAccount) {}

  /**
   * Confirms the e-mail behind the link token and opens the session. One answer for
   * every bad token (unknown, expired, used, wrong type): the reason is not told.
   */
  @Post("confirm-account")
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit("confirm-account")
  async handle(@Body() body: ConfirmAccountDto): Promise<SessionResponse> {
    return traceAuthOperation("confirm_account", async () => {
      try {
        return presentSession(await this.confirmAccount.execute({ token: body.token }));
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
    });
  }
}
