import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { InMemoryRateLimitStore } from "./in-memory-rate-limit-store";
import { AUTH_RATE_LIMIT_POLICIES } from "./rate-limit.policies";
import { RateLimitGuard } from "./rate-limit.guard";
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_STORE,
  type RateLimitClock,
} from "./rate-limit.tokens";

@Module({
  providers: [
    { provide: RATE_LIMIT_CLOCK, useValue: Date.now },
    { provide: RATE_LIMIT_POLICIES, useValue: AUTH_RATE_LIMIT_POLICIES },
    {
      provide: RATE_LIMIT_STORE,
      inject: [RATE_LIMIT_CLOCK],
      useFactory: (clock: RateLimitClock) => new InMemoryRateLimitStore(clock),
    },
    // Global but opt-in: the guard ignores every route without `@RateLimit(...)`.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RATE_LIMIT_STORE, RATE_LIMIT_POLICIES],
})
export class RateLimitModule {}
