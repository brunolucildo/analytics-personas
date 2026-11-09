import { Link } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { describeResendConfirmationFailure } from "./describe-resend-confirmation-failure";
import {
  EMPTY_RESEND_CONFIRMATION_VALUES,
  validateResendConfirmation,
} from "./resend-confirmation-validation";
import { useResendConfirmation } from "./use-resend-confirmation";

const CARD_CLASS = "border-2 border-border bg-card p-6 shadow-[4px_4px_0_0_var(--color-border)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const EMAIL_FIELD_ID = "resend-confirmation-email";

/** Same text for every address: the page must not reveal which e-mails have an account. */
const SUCCESS_MESSAGE =
  "If an account exists for that email and is not confirmed, we sent a new link.";

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

export function ResendConfirmationPage() {
  const resend = useResendConfirmation();
  const [values, setValues] = useState(EMPTY_RESEND_CONFIRMATION_VALUES);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [generalError, setGeneralError] = useState<string>();

  const pending = resend.isPending;
  const clientError = submitted ? validateResendConfirmation(values).email : undefined;
  const emailError = clientError ?? serverError;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValues({ email: event.target.value });
    setServerError(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setGeneralError(undefined);
    setServerError(undefined);

    if (validateResendConfirmation(values).email) {
      document.getElementById(EMAIL_FIELD_ID)?.focus();
      return;
    }

    resend.mutate(values, {
      onError: (error) => {
        const failure = describeResendConfirmationFailure(error);

        setServerError(failure.emailError);
        setGeneralError(failure.general);

        if (failure.emailError) {
          document.getElementById(EMAIL_FIELD_ID)?.focus();
        }
      },
    });
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">Resend confirmation email</h1>

      {resend.isSuccess ? (
        <p role="status" className="mt-4 text-base">
          {SUCCESS_MESSAGE}
        </p>
      ) : (
        <>
          <p className="mt-2 text-base text-muted-foreground">
            Enter the email you signed up with. If the account is not confirmed yet, we will send a
            new link. Older links stop working.
          </p>

          <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
            {generalError ? (
              <p
                role="alert"
                className="border-2 border-destructive bg-background p-3 text-base font-bold text-destructive"
              >
                {generalError}
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor={EMAIL_FIELD_ID}>Email</Label>
              <Input
                id={EMAIL_FIELD_ID}
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={handleChange}
                readOnly={pending}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? `${EMAIL_FIELD_ID}-error` : undefined}
                required
              />
              {emailError ? (
                <p id={`${EMAIL_FIELD_ID}-error`} className="text-base font-bold text-destructive">
                  {emailError}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? (
                <>
                  <Spinner />
                  Sending…
                </>
              ) : (
                "Send new link"
              )}
            </Button>
          </form>
        </>
      )}

      <p className="mt-6 text-base">
        <Link to="/auth/sign-in" className={LINK_CLASS}>
          Back to sign in
        </Link>
      </p>
    </section>
  );
}
