import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiException } from "../../common/api-exception";
import { baseLogger } from "../../observability/logger";
import { RATE_LIMIT_METADATA } from "./rate-limit.decorator";
import { buildRateLimitKey } from "./rate-limit.key";
import type { RateLimitPolicies, RateLimitPolicy } from "./rate-limit.policies";
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_STORE,
  type RateLimitClock,
} from "./rate-limit.tokens";
import type { RateLimitHit, RateLimitStore } from "./rate-limit-store";

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
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_POLICIES) private readonly policies: RateLimitPolicies,
    @Inject(RATE_LIMIT_CLOCK) private readonly now: RateLimitClock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policyName = this.reflector.getAllAndOverride<string | undefined>(RATE_LIMIT_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (policyName === undefined) {
      return true;
    }

    const policy = this.policies[policyName];

    if (policy === undefined) {
      // A typo in a decorator must not leave a route silently unprotected.
      throw new Error(`Unknown rate limit policy "${policyName}".`);
    }

    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitedRequest>();
    const hit = this.count(policyName, policy, context, request);

    if (hit === undefined || hit.count <= policy.limit) {
      return true;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((hit.resetAt - this.now()) / 1000));

    http.getResponse<RateLimitedResponse>().setHeader("Retry-After", retryAfterSeconds);
    baseLogger.warn({ event: "rate_limited", policy: policyName }, "rate_limited");

    throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", RATE_LIMITED_MESSAGE, [
      { retryAfterSeconds },
    ]);
  }

  private count(
    policyName: string,
    policy: RateLimitPolicy,
    context: ExecutionContext,
    request: RateLimitedRequest,
  ): RateLimitHit | undefined {
    try {
      const body = request.body as { email?: unknown } | undefined;
      const key = buildRateLimitKey(policy, {
        route: `${context.getClass().name}.${context.getHandler().name}`,
        policyName,
        ip: request.ip ?? "unknown",
        email: body?.email,
      });

      return this.store.hit(key, policy.windowSeconds * 1000);
    } catch {
      baseLogger.error(
        { event: "rate_limit_store_error", policy: policyName },
        "rate_limit_store_error",
      );

      return undefined;
    }
  }
}
