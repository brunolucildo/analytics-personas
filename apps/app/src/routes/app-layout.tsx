import { Outlet } from "@tanstack/react-router";
import { SessionError, SessionLoading } from "../features/auth/session-states";
import { useRedirect } from "../features/auth/use-redirect";
import { useSession } from "../features/auth/use-session";
import { getAccessToken } from "../lib/access-token";
import { isUnauthenticated } from "../lib/api-client";

/**
 * Layout of the private `/app/*` group and the second half of its guard (the router's
 * `beforeLoad` already sent away visitors without a token). It asks the API who the token
 * belongs to and renders the page only for a valid session: a loading state while it
 * checks, a retry screen when the check itself fails, and the sign-in page when the API
 * says the session is gone (the API client has already dropped the token by then).
 */
export function AppLayout() {
  const session = useSession();
  const lostSession = getAccessToken() === null || isUnauthenticated(session.error);

  useRedirect(lostSession ? "/auth/sign-in" : null);

  let content;

  if (lostSession) {
    content = null;
  } else if (session.data !== undefined) {
    content = <Outlet />;
  } else if (session.isError) {
    content = <SessionError onRetry={() => void session.refetch()} />;
  } else {
    content = <SessionLoading />;
  }

  return (
    <div data-testid="app-layout" className="min-h-screen bg-background text-foreground">
      {content}
    </div>
  );
}
