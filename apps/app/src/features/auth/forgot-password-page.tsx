import { Link } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { describeForgotPasswordFailure } from "./describe-forgot-password-failure";
import { EMPTY_FORGOT_PASSWORD_VALUES, validateForgotPassword } from "./forgot-password-validation";
import { useForgotPassword } from "./use-forgot-password";

const CARD_CLASS = "border-2 border-border bg-card p-6 shadow-[4px_4px_0_0_var(--color-border)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Same text for every address: the page must not reveal which e-mails have an account. */
const SUCCESS_MESSAGE =
  "If an account exists for that email, we sent instructions to reset your password.";

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

export function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword();
  const [values, setValues] = useState(EMPTY_FORGOT_PASSWORD_VALUES);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [generalError, setGeneralError] = useState<string>();

  const pending = forgotPassword.isPending;
  const clientError = submitted ? validateForgotPassword(values).email : undefined;
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

    if (validateForgotPassword(values).email) {
      document.getElementById("forgot-password-email")?.focus();
      return;
    }

    forgotPassword.mutate(values, {
      onError: (error) => {
        const failure = describeForgotPasswordFailure(error);

        setServerError(failure.emailError);
        setGeneralError(failure.general);

        if (failure.emailError) {
          document.getElementById("forgot-password-email")?.focus();
        }
      },
    });
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">Forgot your password?</h1>

      {forgotPassword.isSuccess ? (
        <p role="status" className="mt-4 text-base">
          {SUCCESS_MESSAGE}
        </p>
      ) : (
        <>
          <p className="mt-2 text-base text-muted-foreground">
            Enter the email you signed up with. We will send you a link to choose a new password.
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
              <Label htmlFor="forgot-password-email">Email</Label>
              <Input
                id="forgot-password-email"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={handleChange}
                readOnly={pending}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "forgot-password-email-error" : undefined}
                required
              />
              {emailError ? (
                <p
                  id="forgot-password-email-error"
                  className="text-base font-bold text-destructive"
                >
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
                "Send reset link"
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
