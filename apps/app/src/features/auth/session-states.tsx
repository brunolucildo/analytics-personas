import { RondoMark } from "@repo/ui/brand";
import { Button } from "@repo/ui/button";

/** Shown while `GET /auth/session` runs. A live region, so assistive tech announces it. */
export function SessionLoading() {
  return (
    <div
      role="status"
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-foreground"
    >
      <RondoMark className="size-14" />
      <div className="flex items-center gap-3">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="size-6 animate-spin motion-reduce:animate-none"
        >
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        <span className="text-base font-bold">Verifying your session…</span>
      </div>
    </div>
  );
}

/** The session could not be checked (network or server failure); the token is kept. */
export function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <RondoMark className="size-14" />
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
        We couldn&apos;t verify your session.
      </h1>
      <p className="max-w-md text-muted-foreground">
        Check your connection and try again. You are not signed out.
      </p>
      <Button onClick={onRetry}>Try again</Button>
    </main>
  );
}
