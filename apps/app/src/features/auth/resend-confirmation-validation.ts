export interface ResendConfirmationValues {
  email: string;
}

export type ResendConfirmationErrors = Partial<Record<"email", string>>;

export const EMPTY_RESEND_CONFIRMATION_VALUES: ResendConfirmationValues = { email: "" };

const EMAIL_MAX = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Same e-mail rules the API enforces, to give feedback before sending. The API
 * stays the source of truth: it validates again.
 */
export function validateResendConfirmation(
  values: ResendConfirmationValues,
): ResendConfirmationErrors {
  const email = values.email.trim();

  if (email.length > EMAIL_MAX) {
    return { email: `Email must have at most ${EMAIL_MAX} characters.` };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { email: "Enter a valid email address." };
  }

  return {};
}
