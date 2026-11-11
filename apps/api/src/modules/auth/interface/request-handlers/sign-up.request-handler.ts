import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { ApiException } from "../../../../common/api-exception";
import { Public } from "../../../../common/public.decorator";
import { ServiceBusyException } from "../../../../common/service-busy.exception";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { RateLimit } from "../../../rate-limit";
import { SignUp } from "../../application/use-cases/sign-up.use-case";
import { EmailAlreadyRegisteredError, HashCapacityExceededError } from "../../domain/auth-errors";
import { SignUpDto } from "../dto/sign-up.dto";

@Controller("auth")
export class SignUpRequestHandler {
  constructor(@Inject(SignUp) private readonly signUp: SignUp) {}

  @Post("sign-up")
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit("sign-up")
  async handle(@Body() body: SignUpDto): Promise<{ email: string }> {
    return traceAuthOperation("sign_up", async () => {
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

        if (error instanceof HashCapacityExceededError) {
          throw new ServiceBusyException(error.retryAfterSeconds);
        }

        throw error;
      }
    });
  }
}
