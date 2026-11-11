import { HttpStatus } from "@nestjs/common";
import { ApiException } from "./api-exception";

export const SERVICE_BUSY_CODE = "SERVICE_BUSY";

/**
 * The server cannot take this work now (for example the password-hash queue is full). Answers 503
 * with `Retry-After` and the shared error envelope. It is a deliberate refusal, not a crash: the
 * global filter does not log it as an unhandled exception.
 */
export class ServiceBusyException extends ApiException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      SERVICE_BUSY_CODE,
      "The service is busy right now. Try again shortly.",
      [{ retryAfterSeconds }],
    );
  }
}
