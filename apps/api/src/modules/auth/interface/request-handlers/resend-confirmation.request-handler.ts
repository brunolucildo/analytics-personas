import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { Public } from "../../../../common/public.decorator";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { ResendConfirmation } from "../../application/use-cases/resend-confirmation.use-case";
import { ResendConfirmationDto } from "../dto/resend-confirmation.dto";

@Controller("auth")
export class ResendConfirmationRequestHandler {
  constructor(
    @Inject(ResendConfirmation) private readonly resendConfirmation: ResendConfirmation,
  ) {}

  /**
   * Always answers 202 `{}`, whether the e-mail has an unconfirmed account, a
   * confirmed one or none: the body, the status and the (background) mail delivery
   * keep the route from revealing which addresses are registered.
   */
  @Post("resend-confirmation")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit("resend-confirmation")
  async handle(@Body() body: ResendConfirmationDto): Promise<Record<string, never>> {
    await traceAuthOperation("resend_confirmation", () =>
      this.resendConfirmation.execute({ email: body.email }),
    );

    return {};
  }
}
