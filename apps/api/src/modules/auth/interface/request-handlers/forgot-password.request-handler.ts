import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { Public } from "../../../../common/public.decorator";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { RequestPasswordReset } from "../../application/use-cases/request-password-reset.use-case";
import { ForgotPasswordDto } from "../dto/forgot-password.dto";

@Controller("auth")
export class ForgotPasswordRequestHandler {
  constructor(
    @Inject(RequestPasswordReset) private readonly requestPasswordReset: RequestPasswordReset,
  ) {}

  /**
   * Always answers 202 `{}`, whether the e-mail has a confirmed account, an
   * unconfirmed one or none: the body, the status and the (background) mail
   * delivery keep the route from revealing which addresses are registered.
   */
  @Post("forgot-password")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit("forgot-password")
  async handle(@Body() body: ForgotPasswordDto): Promise<Record<string, never>> {
    await traceAuthOperation("forgot_password", () =>
      this.requestPasswordReset.execute({ email: body.email }),
    );

    return {};
  }
}
