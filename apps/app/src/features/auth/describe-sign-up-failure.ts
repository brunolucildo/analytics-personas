import { ApiError } from "../../lib/api-client";
import { SIGN_UP_FIELDS, type SignUpErrors, type SignUpField } from "./sign-up-validation";

export interface SignUpFailure {
  fieldErrors: SignUpErrors;
  /** Message not tied to a field (rate limit, network, server error). */
  general?: string;
  /** The e-mail already has an account: the page offers a link to sign in. */
  emailTaken: boolean;
}

const GENERIC_MESSAGE = "We could not create your account. Check your connection and try again.";

function isSignUpField(value: unknown): value is SignUpField {
  return SIGN_UP_FIELDS.includes(value as SignUpField);
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
export function describeSignUpFailure(error: unknown): SignUpFailure {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, general: GENERIC_MESSAGE, emailTaken: false };
  }

  if (error.status === 409 && error.code === "EMAIL_ALREADY_REGISTERED") {
    return {
      fieldErrors: { email: "An account with this email already exists." },
      emailTaken: true,
    };
  }

  if (error.status === 429) {
    const wait = retryAfterSeconds(error);
    const hint = wait === undefined ? "" : ` Try again in ${formatWait(wait)}.`;

    return { fieldErrors: {}, general: `Too many sign-up attempts.${hint}`, emailTaken: false };
  }

  if (error.status === 400 && error.code === "VALIDATION_FAILED") {
    const fieldErrors: SignUpErrors = {};

    for (const detail of error.details) {
      if (
        isSignUpField(detail.field) &&
        detail.message &&
        fieldErrors[detail.field] === undefined
      ) {
        fieldErrors[detail.field] = detail.message;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, emailTaken: false };
    }
  }

  return { fieldErrors: {}, general: GENERIC_MESSAGE, emailTaken: false };
}
