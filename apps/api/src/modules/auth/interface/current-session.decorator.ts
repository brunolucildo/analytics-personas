import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ActiveSession } from "../domain/session-ports";
import type { AuthenticatedRequest } from "./guards/auth.guard";

/**
 * The session the `AuthGuard` resolved for this request. Only available on routes
 * that are not `@Public()` (on those the guard never runs, so it is `undefined`).
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().session,
);
