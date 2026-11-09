/** Auth pages that stay reachable while signed in: they act on a link, not on a form. */
const OPEN_WHEN_SIGNED_IN: readonly string[] = ["/auth/confirm-account", "/auth/reset-password"];

/** Where the signed-in user lands instead of an auth page. */
export const SIGNED_IN_HOME = "/app";

/**
 * Where to send the visitor of an `/auth/*` path. A signed-in user leaves every auth page
 * (sign-in, sign-up, forgot-password and anything else) for the home, except the two pages
 * that handle an e-mailed link. Without a session nothing is redirected.
 */
export function getAuthPageRedirect(pathname: string, hasSession: boolean): "/app" | null {
  if (!hasSession) {
    return null;
  }

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  return OPEN_WHEN_SIGNED_IN.includes(path) ? null : SIGNED_IN_HOME;
}
