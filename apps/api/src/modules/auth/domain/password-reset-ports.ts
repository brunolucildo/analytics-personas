/** Ports of the "forgot password" flow (spec 0009): the domain defines them, `infrastructure` implements them. */

export interface PasswordResetToken {
  /** SHA-256 (hex) of the opaque token; the token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
}

export type RequestPasswordResetResult =
  /** The account exists and is confirmed: a new token is stored and the older ones are invalidated. */
  | { status: "created"; firstName: string }
  /** Unknown e-mail or unconfirmed account: nothing was stored. */
  | { status: "no_action" };

export interface PasswordResetRepository {
  /** Atomically invalidates the earlier reset tokens and stores the new one, for a confirmed account only. */
  createForConfirmedUser(
    email: string,
    token: PasswordResetToken,
  ): Promise<RequestPasswordResetResult>;
}

export interface PasswordResetEmail {
  to: string;
  firstName: string;
  token: string;
}

export interface PasswordResetMailer {
  /** Hands the message over for delivery. Never rejects: a mail failure must not change the response. */
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
}
