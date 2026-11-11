import type { RateLimitAllowed, RateLimitLimited } from "../../domain/rate-limit-decision";
import { evaluateRateLimit } from "../../domain/rate-limit-decision";
import { UnknownRateLimitPolicyError } from "../../domain/rate-limit-errors";
import { buildRateLimitKey } from "../../domain/rate-limit-key";
import type { RateLimitPolicies } from "../../domain/rate-limit-policy";
import type { KeyHasher, RateLimitHit, RateLimitStore } from "../../domain/rate-limit-ports";

/** Everything the guard knows about the request; no HTTP object crosses this boundary. */
export interface CheckRateLimitCommand {
  policyNames: readonly string[];
  /** Identity of the route handler, e.g. `SignInRequestHandler.handle`. */
  route: string;
  ip: string;
  /** Raw `email` read from the request body; only a string is used. */
  email: unknown;
}

/**
 * Terminal decision of the check. `unavailablePolicies` lists, in order, every
 * policy whose counter could not be read before the decision was reached: the
 * request is never blocked by them (fail-open), but the caller reports them.
 */
export type CheckRateLimitOutcome =
  | { decision: RateLimitAllowed; unavailablePolicies: readonly string[] }
  | { decision: RateLimitLimited; policyName: string; unavailablePolicies: readonly string[] };

/**
 * Counts one request against every policy of the route, in decorator order, and
 * stops at the first one over its limit. A store failure never blocks the
 * request: the policy is remembered as unavailable and evaluation continues, so
 * the route still answers and the guard can fail open.
 */
export class CheckRateLimit {
  constructor(
    private readonly store: RateLimitStore,
    private readonly policies: RateLimitPolicies,
    private readonly hasher: KeyHasher,
    private readonly now: () => number,
  ) {}

  execute(command: CheckRateLimitCommand): CheckRateLimitOutcome {
    const unavailablePolicies: string[] = [];

    for (const policyName of command.policyNames) {
      const policy = this.policies[policyName];

      // A typo in a decorator must not leave a route silently unprotected.
      if (policy === undefined) {
        throw new UnknownRateLimitPolicyError(policyName);
      }

      let hit: RateLimitHit;

      try {
        const key = buildRateLimitKey(
          policy,
          { route: command.route, policyName, ip: command.ip, email: command.email },
          this.hasher,
        );

        hit = this.store.hit(key, policy.windowSeconds * 1000);
      } catch {
        unavailablePolicies.push(policyName);

        continue;
      }

      const decision = evaluateRateLimit(policy, hit, this.now());

      if (decision.status === "limited") {
        return { decision, policyName, unavailablePolicies };
      }
    }

    return { decision: { status: "allowed" }, unavailablePolicies };
  }
}
