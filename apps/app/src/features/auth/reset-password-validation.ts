export type ResetPasswordField = "password" | "confirmPassword";

export interface ResetPasswordValues {
  password: string;
  confirmPassword: string;
}

export type ResetPasswordErrors = Partial<Record<ResetPasswordField, string>>;

/** Order the fields appear on the page: the first invalid one receives focus. */
export const RESET_PASSWORD_FIELDS: readonly ResetPasswordField[] = ["password", "confirmPassword"];

export const EMPTY_RESET_PASSWORD_VALUES: ResetPasswordValues = {
  password: "",
  confirmPassword: "",
};

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/**
 * Same rules the API enforces, to give feedback before sending (and so before the link is used).
 * The API stays the source of truth: it validates again and can reject what passes here.
 */
export function validateResetPassword(values: ResetPasswordValues): ResetPasswordErrors {
  const errors: ResetPasswordErrors = {};

  if (values.password.length < PASSWORD_MIN || values.password.length > PASSWORD_MAX) {
    errors.password = `Password must have between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`;
  }

  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match";
  }

  return errors;
}
