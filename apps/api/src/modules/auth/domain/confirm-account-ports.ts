/** Ports of the "confirm account" and "resend confirmation" flows (spec 0006): the domain defines them, `infrastructure` implements them. */

import type { ConfirmationToken } from "./auth-ports";

export type RenewConfirmationResult =
  /** The account exists and is unconfirmed: a new token is stored and the older ones are invalidated. */
  | { status: "created"; firstName: string }
  /** Unknown e-mail or account already confirmed: nothing was stored. */
  | { status: "no_action" };

export interface ConfirmationRepository {
  /**
   * Atomically consumes the e-mail confirmation token (by its SHA-256 hash) and confirms the
   * account. Resolves the user id, or `null` when the token is unknown, expired, already used or
   * of another type: the reasons are deliberately not told apart.
   */
  confirmByTokenHash(tokenHash: string): Promise<string | null>;

  /**
   * Atomically invalidates the earlier confirmation tokens and stores the new one, for an
   * unconfirmed account only.
   */
  renewForUnconfirmedUser(
    email: string,
    token: ConfirmationToken,
  ): Promise<RenewConfirmationResult>;
}
