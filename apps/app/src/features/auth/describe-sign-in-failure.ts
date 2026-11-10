import { ApiError } from "../../lib/api-client";
import { SIGN_IN_FIELDS, type SignInErrors, type SignInField } from "./sign-in-validation";

export interface SignInFailure {
  fieldErrors: SignInErrors;
  /** Message not tied to a field (bad credentials, rate limit, network, server error). */
  general?: string;
  /** The account exists but is not confirmed: the page offers the resend link. */
  unconfirmed: boolean;
}

/** One message for a missing account and a wrong password: the page must not tell them apart. */
export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
export const NOT_CONFIRMED_MESSAGE = "Confirm your email to sign in.";
const GENERIC_MESSAGE = "We could not sign you in. Check your connection and try again.";

function isSignInField(value: unknown): value is SignInField {
  return SIGN_IN_FIELDS.includes(value as SignInField);
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

/** Translates an API failure into field errors and/or a general message. */
export function describeSignInFailure(error: unknown): SignInFailure {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, general: GENERIC_MESSAGE, unconfirmed: false };
  }

  if (error.status === 401 && error.code === "INVALID_CREDENTIALS") {
    return { fieldErrors: {}, general: INVALID_CREDENTIALS_MESSAGE, unconfirmed: false };
  }

  if (error.status === 403 && error.code === "EMAIL_NOT_CONFIRMED") {
    return { fieldErrors: {}, general: NOT_CONFIRMED_MESSAGE, unconfirmed: true };
  }

  if (error.status === 429) {
    const wait = retryAfterSeconds(error);
    const hint = wait === undefined ? "" : ` Try again in ${formatWait(wait)}.`;

    return { fieldErrors: {}, general: `Too many sign-in attempts.${hint}`, unconfirmed: false };
  }

  if (error.status === 400 && error.code === "VALIDATION_FAILED") {
    const fieldErrors: SignInErrors = {};

    for (const detail of error.details) {
      if (
        isSignInField(detail.field) &&
        detail.message &&
        fieldErrors[detail.field] === undefined
      ) {
        fieldErrors[detail.field] = detail.message;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, unconfirmed: false };
    }
  }

  return { fieldErrors: {}, general: GENERIC_MESSAGE, unconfirmed: false };
}
