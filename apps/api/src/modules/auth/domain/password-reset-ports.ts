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

/** Who the consumed reset token belonged to (spec 0010). */
export interface PasswordResetOwner {
  userId: string;
  firstName: string;
  /** Recipient of the "password changed" notice. Never logged. */
  email: string;
}

export interface PasswordResetRepository {
  /** Atomically invalidates the earlier reset tokens and stores the new one, for a confirmed account only. */
  createForConfirmedUser(
    email: string,
    token: PasswordResetToken,
  ): Promise<RequestPasswordResetResult>;

  /**
   * Atomically consumes the `password_reset` token (by its SHA-256 hash), stores the new password
   * hash, invalidates the user's other reset tokens and revokes every session of the user.
   * Resolves the token owner, or `null` when the token is unknown, expired, already used or of
   * another type: the reasons are deliberately not told apart.
   */
  resetByTokenHash(tokenHash: string, passwordHash: string): Promise<PasswordResetOwner | null>;
}

export interface PasswordChangedEmail {
  to: string;
  firstName: string;
  /** Moment the password was changed. */
  changedAt: Date;
}

export interface PasswordChangedMailer {
  /** Hands the notice over for delivery. Never rejects: a mail failure must not change the response. */
  sendPasswordChanged(email: PasswordChangedEmail): Promise<void>;
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
