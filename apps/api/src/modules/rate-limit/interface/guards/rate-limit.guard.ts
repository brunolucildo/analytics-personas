import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiException } from "../../../../common/api-exception";
import { baseLogger } from "../../../../observability/logger";
import { CheckRateLimit } from "../../application/use-cases/check-rate-limit.use-case";
import { RATE_LIMIT_METADATA } from "../decorators/rate-limit.decorator";

interface RateLimitedRequest {
  ip?: string;
  body?: unknown;
}

interface RateLimitedResponse {
  setHeader(name: string, value: string | number): unknown;
}

const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";

/**
 * Global guard that only acts on routes carrying `@RateLimit('<policy>')`.
 * Over the limit it answers 429 with `Retry-After` and the shared error envelope.
 * If the store fails, the request passes (fail-open) so the limiter never takes login down.
 * Logs carry only the event and the policy name: never the IP, e-mail or key.
 * The decision itself lives in `CheckRateLimit`; this class only speaks HTTP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CheckRateLimit) private readonly checkRateLimit: CheckRateLimit,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.getAllAndOverride<string | readonly string[] | undefined>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (metadata === undefined) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitedRequest>();
    const body = request.body as { email?: unknown } | undefined;
    const outcome = this.checkRateLimit.execute({
      policyNames: typeof metadata === "string" ? [metadata] : metadata,
      route: `${context.getClass().name}.${context.getHandler().name}`,
      ip: request.ip ?? "unknown",
      email: body?.email,
    });

    for (const policyName of outcome.unavailablePolicies) {
      baseLogger.error(
        { event: "rate_limit_store_error", policy: policyName },
        "rate_limit_store_error",
      );
    }

    if (outcome.decision.status === "allowed" || !("policyName" in outcome)) {
      return true;
    }

    const { retryAfterSeconds } = outcome.decision;

    http.getResponse<RateLimitedResponse>().setHeader("Retry-After", retryAfterSeconds);
    baseLogger.warn({ event: "rate_limited", policy: outcome.policyName }, "rate_limited");

    throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", RATE_LIMITED_MESSAGE, [
      { retryAfterSeconds },
    ]);
  }
}
