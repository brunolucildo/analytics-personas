export type SignUpField = "firstName" | "lastName" | "email" | "password" | "confirmPassword";

export interface SignUpValues {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type SignUpErrors = Partial<Record<SignUpField, string>>;

export const EMPTY_SIGN_UP_VALUES: SignUpValues = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export const SIGN_UP_FIELDS: SignUpField[] = [
  "firstName",
  "lastName",
  "email",
  "password",
  "confirmPassword",
];

const NAME_MAX = 100;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateName(label: string, value: string): string | undefined {
  const length = value.trim().length;

  if (length < 1 || length > NAME_MAX) {
    return `${label} must have between 1 and ${NAME_MAX} characters.`;
  }

  return undefined;
}

/**
 * Same rules the API enforces, to give feedback before sending. The API stays
 * the source of truth: it validates again and can reject what passes here.
 */
export function validateSignUp(values: SignUpValues): SignUpErrors {
  const errors: SignUpErrors = {};
  const email = values.email.trim();
  const firstName = validateName("First name", values.firstName);
  const lastName = validateName("Last name", values.lastName);

  if (firstName) {
    errors.firstName = firstName;
  }

  if (lastName) {
    errors.lastName = lastName;
  }

  if (email.length > EMAIL_MAX) {
    errors.email = `Email must have at most ${EMAIL_MAX} characters.`;
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (values.password.length < PASSWORD_MIN || values.password.length > PASSWORD_MAX) {
    errors.password = `Password must have between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`;
  }

  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match";
  }

  return errors;
}
