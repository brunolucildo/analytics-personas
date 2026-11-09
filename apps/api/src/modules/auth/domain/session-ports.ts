/** Ports of the session service: the domain defines them, `infrastructure` implements them. */

/** The public fields of a user, as the session responses expose them. */
export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface StoredSession {
  id: string;
  expiresAt: Date;
  /** Null while the session is active. */
  revokedAt: Date | null;
  user: SessionUser;
}

export interface CreatedSession {
  sessionId: string;
  user: SessionUser;
}

export interface SessionRepository {
  /**
   * Atomically revokes the user's active session and starts a new one.
   * Resolves `null` when the user does not exist.
   */
  issue(userId: string, expiresAt: Date): Promise<CreatedSession | null>;
  findById(sessionId: string): Promise<StoredSession | null>;
  /** Idempotent: revoking a revoked or unknown session does nothing. */
  revoke(sessionId: string): Promise<void>;
}

/** The only claims the token carries (plus `iat` and `exp`): no PII. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id, checked against the database on every request. */
  sid: string;
}

export interface AccessTokenSigner {
  sign(claims: AccessTokenClaims, issuedAt: Date, expiresAt: Date): Promise<string>;
  /** Resolves `null` for anything wrong with the token: signature, algorithm, expiry, shape. */
  verify(token: string): Promise<AccessTokenClaims | null>;
}

export interface IssuedSession {
  accessToken: string;
  expiresAt: Date;
  user: SessionUser;
}

/** A session that passed every check; what the guard attaches to the request. */
export interface ActiveSession {
  sessionId: string;
  userId: string;
  user: SessionUser;
}
