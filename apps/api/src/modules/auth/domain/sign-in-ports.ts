/** Ports of the "sign in" flow (spec 0007): the domain defines them, `infrastructure` implements them. */

export interface StoredCredentials {
  userId: string;
  /** Argon2id hash of the password. Never leaves the use case. */
  passwordHash: string;
  /** False until the e-mail link is confirmed (spec 0006). */
  emailConfirmed: boolean;
}

export interface CredentialsRepository {
  /** Looks the account up by its already normalized e-mail; `null` when there is none. */
  findByEmail(email: string): Promise<StoredCredentials | null>;
}

export interface PasswordVerifier {
  /**
   * Whether `plain` matches `hash`. `null` stands for "no such account": the call then spends
   * about the same time as a real check and resolves `false`, so the response time does not
   * tell a missing account from a wrong password.
   */
  verify(plain: string, hash: string | null): Promise<boolean>;
}

export interface NewSessionEmail {
  to: string;
  firstName: string;
  /** Moment the session was opened. */
  signedInAt: Date;
}

export interface NewSessionMailer {
  /** Hands the notice over for delivery. Never rejects: a mail failure must not fail the sign-in. */
  sendNewSession(email: NewSessionEmail): Promise<void>;
}
