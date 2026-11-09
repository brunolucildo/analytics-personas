export type SignInField = "email" | "password";

export interface SignInValues {
  email: string;
  password: string;
}

export type SignInErrors = Partial<Record<SignInField, string>>;

/** Order the fields appear on the page: the first invalid one receives focus. */
export const SIGN_IN_FIELDS: readonly SignInField[] = ["email", "password"];

export const EMPTY_SIGN_IN_VALUES: SignInValues = { email: "", password: "" };

const EMAIL_MAX = 254;
const PASSWORD_MAX = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Same shape rules the API enforces on the body, to give feedback before sending. The password
 * is only checked for presence and the API ceiling: whether it is right is the API's call (a
 * short one is just a wrong one), and the page never says which rule a real password broke.
 */
export function validateSignIn(values: SignInValues): SignInErrors {
  const errors: SignInErrors = {};
  const email = values.email.trim();

  if (email.length > EMAIL_MAX) {
    errors.email = `Email must have at most ${EMAIL_MAX} characters.`;
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (values.password === "") {
    errors.password = "Enter your password.";
  } else if (values.password.length > PASSWORD_MAX) {
    errors.password = `Password must have at most ${PASSWORD_MAX} characters.`;
  }

  return errors;
}
