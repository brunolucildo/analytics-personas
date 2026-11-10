/** Raised when a session is requested for a user that does not exist. */
export class SessionUserNotFoundError extends Error {
  constructor() {
    super("Cannot issue a session: user not found.");
    this.name = "SessionUserNotFoundError";
  }
}
