import { Controller, Get, Inject } from "@nestjs/common";
import { GetSession } from "../../application/use-cases/get-session.use-case";
import type { ActiveSession } from "../../domain/session-ports";
import { CurrentSession } from "../current-session.decorator";
import { presentUser, type UserResponse } from "../presenters/session.presenter";

@Controller("auth")
export class GetSessionRequestHandler {
  constructor(@Inject(GetSession) private readonly getSession: GetSession) {}

  /** The user behind the current session (the guard already validated it). */
  @Get("session")
  handle(@CurrentSession() session: ActiveSession): { user: UserResponse } {
    return { user: presentUser(this.getSession.execute(session)) };
  }
}
