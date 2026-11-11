import type { KeyHasher } from "./rate-limit-ports";
import type { RateLimitPolicy } from "./rate-limit-policy";

export interface RateLimitKeyParts {
  /** Identity of the route handler, e.g. `SignInRequestHandler.handle`. */
  route: string;
  policyName: string;
  ip: string;
  /** Raw `email` read from the request body; only a string is used. */
  email: unknown;
}

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Builds the plain-text key material from route, policy, IP and, when the policy
 * asks for it, the normalized e-mail. Kept separate from the hash so the
 * composition with the hasher stays a pure function of its inputs.
 */
export function buildRateLimitKeyParts(policy: RateLimitPolicy, parts: RateLimitKeyParts): string {
  const email = policy.keyBy === "ip-and-email" ? (normalizeEmail(parts.email) ?? "") : "";

  return JSON.stringify([parts.route, parts.policyName, parts.ip, email]);
}

/**
 * Builds the counter key. The key is hashed so neither IP nor e-mail sit in memory
 * as plain text, and its length stays constant. It is never logged.
 */
export function buildRateLimitKey(
  policy: RateLimitPolicy,
  parts: RateLimitKeyParts,
  hasher: KeyHasher,
): string {
  return hasher.hash(buildRateLimitKeyParts(policy, parts));
}
