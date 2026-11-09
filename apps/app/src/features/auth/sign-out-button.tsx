import { Button } from "@repo/ui/button";
import { useSignOut } from "./use-sign-out";

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="animate-spin motion-reduce:animate-none"
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

/** Ends the current session. Disabled while the request runs, so it cannot be sent twice. */
export function SignOutButton() {
  const signOut = useSignOut();

  return (
    <Button
      variant="outline"
      className="min-w-28"
      disabled={signOut.isPending}
      aria-busy={signOut.isPending}
      onClick={() => signOut.mutate()}
    >
      {signOut.isPending ? <Spinner /> : null}
      Sign out
    </Button>
  );
}
