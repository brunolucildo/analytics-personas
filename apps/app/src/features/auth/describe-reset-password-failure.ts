import { ApiError } from "../../lib/api-client";
import {
  RESET_PASSWORD_FIELDS,
  type ResetPasswordErrors,
  type ResetPasswordField,
} from "./reset-password-validation";

export interface ResetPasswordFailure {
  fieldErrors: ResetPasswordErrors;
  /** The link will never work (unknown, expired, used): the page leaves the form for the invalid-link state. */
  linkInvalid: boolean;
  /** Message not tied to a field (rate limit, network, server error). */
  general?: string;
}

const GENERIC_MESSAGE = "We could not reset your password. Check your connection and try again.";

function isResetPasswordField(value: unknown): value is ResetPasswordField {
  return RESET_PASSWORD_FIELDS.includes(value as ResetPasswordField);
}

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

/** Translates an API failure into field errors, the invalid-link state or a general message. */
export function describeResetPasswordFailure(error: unknown): ResetPasswordFailure {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, linkInvalid: false, general: GENERIC_MESSAGE };
  }

  if (error.status === 400 && error.code === "TOKEN_INVALID_OR_EXPIRED") {
    return { fieldErrors: {}, linkInvalid: true };
  }

  if (error.status === 429) {
    const wait = retryAfterSeconds(error);
    const hint = wait === undefined ? "" : ` Try again in ${formatWait(wait)}.`;

    return { fieldErrors: {}, linkInvalid: false, general: `Too many attempts.${hint}` };
  }

  if (error.status === 400 && error.code === "VALIDATION_FAILED") {
    const fieldErrors: ResetPasswordErrors = {};

    for (const detail of error.details) {
      if (
        isResetPasswordField(detail.field) &&
        detail.message &&
        fieldErrors[detail.field] === undefined
      ) {
        fieldErrors[detail.field] = detail.message;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, linkInvalid: false };
    }
  }

  return { fieldErrors: {}, linkInvalid: false, general: GENERIC_MESSAGE };
}
