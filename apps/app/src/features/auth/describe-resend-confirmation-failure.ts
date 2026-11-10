import { ApiError } from "../../lib/api-client";

export interface ResendConfirmationFailure {
  /** Message tied to the e-mail field (400 from the API). */
  emailError?: string;
  /** Message not tied to a field (rate limit, network, server error). */
  general?: string;
}

const GENERIC_MESSAGE = "We could not send the link. Check your connection and try again.";

function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.ceil(seconds / 60);

  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function retryAfterSeconds(error: ApiError): number | undefined {
  const detail = error.details.find((item) => typeof item.retryAfterSeconds === "number");

  return typeof detail?.retryAfterSeconds === "number" ? detail.retryAfterSeconds : undefined;
}

/** Translates an API failure into an e-mail field error or a general message. */
export function describeResendConfirmationFailure(error: unknown): ResendConfirmationFailure {
  if (!(error instanceof ApiError)) {
    return { general: GENERIC_MESSAGE };
  }

  if (error.status === 429) {
    const wait = retryAfterSeconds(error);
    const hint = wait === undefined ? "" : ` Try again in ${formatWait(wait)}.`;

    return { general: `Too many requests.${hint}` };
  }

  if (error.status === 400 && error.code === "VALIDATION_FAILED") {
    const message = error.details.find(
      (detail) => detail.field === "email" && detail.message,
    )?.message;

    if (message) {
      return { emailError: message };
    }
  }

  return { general: GENERIC_MESSAGE };
}
