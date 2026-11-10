/** Raised when a sign-up uses an e-mail that already has an account. */
export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    // The address is PII, so it is deliberately not part of the message.
    super("Email already registered.");
    this.name = "EmailAlreadyRegisteredError";
  }
}

/**
 * Raised when a link token is unknown, expired, already used or of another type. One error
 * for every reason, so nothing downstream can tell them apart.
 */
export class InvalidConfirmationTokenError extends Error {
  constructor() {
    super("Invalid or expired confirmation token.");
    this.name = "InvalidConfirmationTokenError";
  }
}

/**
 * Raised when a password reset token is unknown, expired, already used or of another type. One
 * error for every reason, so nothing downstream can tell them apart.
 */
export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super("Invalid or expired password reset token.");
    this.name = "InvalidPasswordResetTokenError";
  }
}

/**
 * Raised when the e-mail has no account or the password is wrong. One error for both, so
 * nothing downstream can tell them apart.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

/** Raised when the password is right but the e-mail address was never confirmed. */
export class EmailNotConfirmedError extends Error {
  constructor() {
    super("Email not confirmed.");
    this.name = "EmailNotConfirmedError";
  }
}
