/** Raised when a sign-up uses an e-mail that already has an account. */
export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    // The address is PII, so it is deliberately not part of the message.
    super("Email already registered.");
    this.name = "EmailAlreadyRegisteredError";
  }
}
