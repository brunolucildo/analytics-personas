import { createHash } from "node:crypto";
import type { RateLimitPolicy } from "./rate-limit.policies";

export interface RateLimitKeyParts {
  /** Identity of the route handler, e.g. `AuthController.signIn`. */
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
 * Builds the counter key from route, policy, IP and, when the policy asks for it,
 * the normalized e-mail. The key is hashed so neither IP nor e-mail sit in memory
 * as plain text, and its length stays constant. It is never logged.
 */
export function buildRateLimitKey(policy: RateLimitPolicy, parts: RateLimitKeyParts): string {
  const email = policy.keyBy === "ip-and-email" ? (normalizeEmail(parts.email) ?? "") : "";
  const raw = JSON.stringify([parts.route, parts.policyName, parts.ip, email]);

  return createHash("sha256").update(raw).digest("hex");
}
