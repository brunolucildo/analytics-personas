/** Ports of the auth module: the domain defines them, `infrastructure` implements them. */

export interface NewUser {
  firstName: string;
  lastName: string;
  /** Already normalized (trim + lower case). */
  email: string;
  passwordHash: string;
}

export interface ConfirmationToken {
  /** SHA-256 (hex) of the opaque token; the token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
}

export type CreateUserResult = { status: "created"; userId: string } | { status: "email_taken" };

export interface UserRepository {
  /** Atomically creates the unconfirmed user and its confirmation token. */
  createWithConfirmationToken(user: NewUser, token: ConfirmationToken): Promise<CreateUserResult>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
}

export interface IssuedToken {
  /** Goes to the user inside the link. Never persisted or logged. */
  token: string;
  tokenHash: string;
}

export interface TokenGenerator {
  generate(): IssuedToken;
}

export interface ConfirmationEmail {
  to: string;
  firstName: string;
  token: string;
}

export interface ConfirmationMailer {
  /** Hands the message over for delivery. Never rejects: a mail failure must not undo the sign-up. */
  sendConfirmation(email: ConfirmationEmail): Promise<void>;
}
