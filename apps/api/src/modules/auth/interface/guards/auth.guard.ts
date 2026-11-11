import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiException } from "../../../../common/api-exception";
import { IS_PUBLIC_METADATA } from "../../../../common/public.decorator";
import { SessionService } from "../../application/services/session.service";
import type { ActiveSession } from "../../domain/session-ports";

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  /** Set by the guard on every route that is not `@Public()`. */
  session?: ActiveSession;
}

const BEARER_SCHEME = "bearer";

/** The token of an `Authorization: Bearer <token>` header, or `undefined` for anything else. */
export function readBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const parts = header.split(" ");
  const [scheme, token] = parts;

  return parts.length === 2 && scheme?.toLowerCase() === BEARER_SCHEME && token ? token : undefined;
}

/**
 * Global guard: the API is closed by default. A route without `@Public()` needs a
 * bearer token whose signature, claims and session (checked in the database on
 * every request) are all valid. Every failure answers the same 401, so the
 * response never says which part was wrong.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request.headers.authorization);
    const session = token === undefined ? null : await this.sessions.authenticate(token);

    if (session === null) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "UNAUTHENTICATED",
        "Authentication required.",
      );
    }

    request.session = session;

    return true;
  }
}
