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
