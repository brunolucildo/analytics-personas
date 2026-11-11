import { Controller, HttpCode, HttpStatus, Inject, Post } from "@nestjs/common";
import { traceAuthOperation } from "../../../../observability/auth-telemetry";
import { SignOut } from "../../application/use-cases/sign-out.use-case";
import type { ActiveSession } from "../../domain/session-ports";
import { CurrentSession } from "../current-session.decorator";

@Controller("auth")
export class SignOutRequestHandler {
  constructor(@Inject(SignOut) private readonly signOut: SignOut) {}

  /**
   * Revokes the session of the bearer token. Closed by default (no `@Public()`): without a
   * valid session the guard answers 401 before this runs, so it can only end its own session.
   */
  @Post("sign-out")
  @HttpCode(HttpStatus.NO_CONTENT)
  async handle(@CurrentSession() session: ActiveSession): Promise<void> {
    await traceAuthOperation("sign_out", () => this.signOut.execute(session.sessionId));
  }
}
