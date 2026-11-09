/** Credential and identity rules shared by every auth use case (epic decisions, spec 0004 §2). */
export const AUTH_LIMITS = {
  nameMin: 1,
  nameMax: 100,
  emailMax: 254,
  passwordMin: 8,
  passwordMax: 128,
} as const;

/** The e-mail confirmation link stays valid for 24 hours. */
export const CONFIRMATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string): string {
  return value.trim();
}

/** Expects an already normalized name. */
export function isNameLengthValid(value: string): boolean {
  return value.length >= AUTH_LIMITS.nameMin && value.length <= AUTH_LIMITS.nameMax;
}

/** Length is the only password rule: no composition requirements. */
export function isPasswordLengthValid(value: string): boolean {
  return value.length >= AUTH_LIMITS.passwordMin && value.length <= AUTH_LIMITS.passwordMax;
}

/** The password reset link stays valid for 1 hour. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
