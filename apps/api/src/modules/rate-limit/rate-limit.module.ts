import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CheckRateLimit } from "./application/use-cases/check-rate-limit.use-case";
import type { KeyHasher, RateLimitStore } from "./domain/rate-limit-ports";
import { AUTH_RATE_LIMIT_POLICIES, type RateLimitPolicies } from "./domain/rate-limit-policy";
import { InMemoryRateLimitStore } from "./infrastructure/in-memory-rate-limit-store";
import { NodeCryptoKeyHasher } from "./infrastructure/node-crypto-key-hasher";
import { RateLimitGuard } from "./interface/guards/rate-limit.guard";
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_KEY_HASHER,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_STORE,
  type RateLimitClock,
} from "./rate-limit.tokens";

@Module({
  providers: [
    { provide: RATE_LIMIT_CLOCK, useValue: Date.now },
    { provide: RATE_LIMIT_POLICIES, useValue: AUTH_RATE_LIMIT_POLICIES },
    { provide: RATE_LIMIT_KEY_HASHER, useClass: NodeCryptoKeyHasher },
    {
      provide: RATE_LIMIT_STORE,
      inject: [RATE_LIMIT_CLOCK],
      useFactory: (clock: RateLimitClock) => new InMemoryRateLimitStore(clock),
    },
    {
      provide: CheckRateLimit,
      inject: [RATE_LIMIT_STORE, RATE_LIMIT_POLICIES, RATE_LIMIT_KEY_HASHER, RATE_LIMIT_CLOCK],
      useFactory: (
        store: RateLimitStore,
        policies: RateLimitPolicies,
        hasher: KeyHasher,
        clock: RateLimitClock,
      ) => new CheckRateLimit(store, policies, hasher, clock),
    },
    // Global but opt-in: the guard ignores every route without `@RateLimit(...)`.
    // `AppModule` keeps it ahead of `AuthGuard`.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RATE_LIMIT_STORE, RATE_LIMIT_POLICIES],
})
export class RateLimitModule {}
