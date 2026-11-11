export type RateLimitKeyBy = "ip" | "ip-and-email";

export interface RateLimitPolicy {
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
  /** `ip-and-email` also splits the quota by the normalized `email` of the body. */
  keyBy: RateLimitKeyBy;
}

/**
 * Default policies for the authentication routes. This is the single place that
 * holds the numbers; each auth spec applies its policy with `@RateLimit('<name>')`.
 */
export const AUTH_RATE_LIMIT_POLICIES = {
  "sign-up": { limit: 5, windowSeconds: 60 * 60, keyBy: "ip" },
  // Per IP regardless of the e-mail: the per IP and e-mail policy below never stops one client
  // that changes e-mail on every attempt, and each attempt costs a password hash.
  "sign-in-ip": { limit: 60, windowSeconds: 10 * 60, keyBy: "ip" },
  "sign-in": { limit: 10, windowSeconds: 10 * 60, keyBy: "ip-and-email" },
  "confirm-account": { limit: 10, windowSeconds: 10 * 60, keyBy: "ip" },
  "resend-confirmation": { limit: 3, windowSeconds: 10 * 60, keyBy: "ip-and-email" },
  "forgot-password": { limit: 3, windowSeconds: 10 * 60, keyBy: "ip-and-email" },
  "reset-password": { limit: 10, windowSeconds: 10 * 60, keyBy: "ip" },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicies = Readonly<Record<string, RateLimitPolicy>>;
