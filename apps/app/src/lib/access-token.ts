/** `localStorage` key of the access token (contract shared by the auth specs). */
export const ACCESS_TOKEN_KEY = "access_token";

/**
 * Fallback for when `localStorage` is unavailable (private mode, blocked site data):
 * the token then lives only in memory, so the page still works until it is reloaded.
 */
let memoryToken: string | null = null;

/** The stored access token, or `null` when there is none. Never throws. */
export function getAccessToken(): string | null {
  try {
    const stored = window.localStorage.getItem(ACCESS_TOKEN_KEY);

    return stored === null || stored === "" ? null : stored;
  } catch {
    return memoryToken;
  }
}

/** Stores the token returned by a sign-in or confirmation. Never throws. */
export function setAccessToken(token: string): void {
  memoryToken = token;

  try {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // Storage is not available: the in-memory copy keeps this page session working.
  }
}

/** Forgets the token (sign-out, or the API said the session is gone). Never throws. */
export function clearAccessToken(): void {
  memoryToken = null;

  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // Nothing persisted, nothing to remove.
  }
}
