export type EmailDeliveryErrorCode =
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAUTHORIZED";

/**
 * Typed failure of an e-mail delivery. The message never carries provider
 * response bodies, recipients or credentials, so it is safe to log.
 */
export class EmailDeliveryError extends Error {
  constructor(
    readonly code: EmailDeliveryErrorCode,
    /** True when trying again can succeed (timeout, network, 5xx, 408, 429). */
    readonly retryable: boolean,
    readonly attempts = 1,
  ) {
    super(`E-mail delivery failed: ${code}`);
    this.name = "EmailDeliveryError";
  }

  withAttempts(attempts: number): EmailDeliveryError {
    return new EmailDeliveryError(this.code, this.retryable, attempts);
  }
}
