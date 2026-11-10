import { Link, useSearch } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";
import { useEffect, useRef } from "react";
import { ApiError } from "../../lib/api-client";
import { useConfirmAccount } from "./use-confirm-account";
import { useRedirect } from "./use-redirect";

const CARD_CLASS = "border-2 border-border bg-card p-6 shadow-[4px_4px_0_0_var(--color-border)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Any answer that says "this token will never work" (the API does not say which reason). */
function isDeadLink(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

function Spinner() {
  return (
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
  );
}

function InvalidLink() {
  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">This link is invalid or has expired</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Confirmation links work once and expire after 24 hours.
      </p>
      <p className="mt-6 text-base">
        <Link to="/auth/resend-confirmation" className={LINK_CLASS}>
          Request a new confirmation email
        </Link>
      </p>
    </section>
  );
}

/**
 * Confirms the account when it opens: a `POST` with the token of the link (never a `GET`, so a
 * mail scanner that only fetches the URL does not use the link up). It runs once per visit, even
 * when React StrictMode mounts the page twice, stores the session token and goes to `/app`.
 */
export function ConfirmAccountPage() {
  const search: { token?: unknown } = useSearch({ strict: false });
  const token = typeof search.token === "string" && search.token !== "" ? search.token : null;
  const confirm = useConfirmAccount();
  const { mutate } = confirm;
  // A ref survives the unmount/remount StrictMode simulates, so the call is made once.
  const started = useRef(false);

  useEffect(() => {
    if (token !== null && !started.current) {
      started.current = true;
      mutate(token);
    }
  }, [token, mutate]);

  useRedirect(confirm.isSuccess ? "/app" : null);

  if (token === null || (confirm.isError && isDeadLink(confirm.error))) {
    return <InvalidLink />;
  }

  if (confirm.isError) {
    const tooMany = confirm.error instanceof ApiError && confirm.error.status === 429;

    return (
      <section className={CARD_CLASS}>
        <h1 className="text-3xl font-black tracking-tight">
          We couldn&apos;t confirm your account
        </h1>
        <p role="alert" className="mt-2 text-base text-muted-foreground">
          {tooMany
            ? "Too many attempts. Try again in a few minutes."
            : "Check your connection and try again."}
        </p>
        <div className="mt-6">
          <Button size="lg" onClick={() => mutate(token)}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">Confirm your account</h1>
      <p role="status" className="mt-4 flex items-center gap-3 text-base font-bold">
        <Spinner />
        Confirming your account…
      </p>
    </section>
  );
}
