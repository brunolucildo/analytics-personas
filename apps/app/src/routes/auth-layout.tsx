import { Outlet, useLocation } from "@tanstack/react-router";
import { getAuthPageRedirect } from "../features/auth/auth-redirect";
import { SessionLoading } from "../features/auth/session-states";
import { useRedirect } from "../features/auth/use-redirect";
import { useSession } from "../features/auth/use-session";

/**
 * Layout of the public `/auth/*` group (sign-up, sign-in, password recovery). A visitor
 * with a valid session is sent to `/app` (except on the link pages); with a stored token
 * the page waits for the check, and an invalid or unverifiable token never blocks it.
 */
export function AuthLayout() {
  const { pathname } = useLocation();
  const session = useSession();
  const redirect = getAuthPageRedirect(pathname, session.data !== undefined);
  const mustWait = session.isLoading && getAuthPageRedirect(pathname, true) !== null;

  useRedirect(redirect);

  if (redirect !== null) {
    return null;
  }

  return (
    <div
      data-testid="auth-layout"
      className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground"
    >
      {mustWait ? (
        <SessionLoading />
      ) : (
        <main className="w-full max-w-md">
          <Outlet />
        </main>
      )}
    </div>
  );
}
