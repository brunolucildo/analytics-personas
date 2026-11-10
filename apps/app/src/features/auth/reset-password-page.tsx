import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import { PasswordInput } from "@repo/ui/password-input";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { describeResetPasswordFailure } from "./describe-reset-password-failure";
import {
  EMPTY_RESET_PASSWORD_VALUES,
  RESET_PASSWORD_FIELDS,
  validateResetPassword,
  type ResetPasswordErrors,
  type ResetPasswordField,
  type ResetPasswordValues,
} from "./reset-password-validation";
import { useResetPassword } from "./use-reset-password";

interface FieldConfig {
  label: string;
  visibilityLabel: string;
}

const FIELDS: Record<ResetPasswordField, FieldConfig> = {
  password: { label: "New password", visibilityLabel: "new password" },
  confirmPassword: { label: "Confirm new password", visibilityLabel: "password confirmation" },
};

const CARD_CLASS = "border-2 border-border bg-card p-6 shadow-[4px_4px_0_0_var(--color-border)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function focusField(name: ResetPasswordField) {
  document.getElementById(`reset-password-${name}`)?.focus();
}

function firstInvalid(errors: ResetPasswordErrors): ResetPasswordField | undefined {
  return RESET_PASSWORD_FIELDS.find((name) => errors[name] !== undefined);
}

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

function InvalidLink() {
  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">This link is invalid or has expired</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Reset links work once and expire after 1 hour.
      </p>
      <p className="mt-6 text-base">
        <Link to="/auth/forgot-password" className={LINK_CLASS}>
          Request a new reset link
        </Link>
      </p>
    </section>
  );
}

/**
 * Chooses a new password with the token of the e-mailed link. The token is read from the URL
 * once, kept in this component (memory only) and removed from the address bar right away, so it
 * does not stay in the history or leak through `Referer`; reloading therefore shows the
 * invalid-link state. On success the person goes to the sign-in page (no session is opened).
 */
export function ResetPasswordPage() {
  const router = useRouter();
  const search: { token?: unknown } = useSearch({ strict: false });
  const [token] = useState<string | null>(() =>
    typeof search.token === "string" && search.token !== "" ? search.token : null,
  );
  const hasTokenInUrl = search.token !== undefined;
  const resetPassword = useResetPassword();
  const [values, setValues] = useState<ResetPasswordValues>(EMPTY_RESET_PASSWORD_VALUES);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ResetPasswordErrors>({});
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [generalError, setGeneralError] = useState<string>();
  const stripped = useRef(false);

  // Drop the token from the URL as soon as the page loads (`replace`: no history entry keeps it).
  useEffect(() => {
    if (hasTokenInUrl && !stripped.current) {
      stripped.current = true;
      void router.navigate({ to: "/auth/reset-password", search: {}, replace: true });
    }
  }, [hasTokenInUrl, router]);

  const { isSuccess } = resetPassword;

  useEffect(() => {
    if (isSuccess) {
      void router.navigate({ to: "/auth/sign-in", search: { reset: "success" }, replace: true });
    }
  }, [isSuccess, router]);

  if (token === null || linkInvalid) {
    return <InvalidLink />;
  }

  if (isSuccess) {
    return (
      <section className={CARD_CLASS}>
        <h1 className="text-3xl font-black tracking-tight">Choose a new password</h1>
        <p role="status" className="mt-4 text-base font-bold">
          Password updated. Taking you to sign in…
        </p>
      </section>
    );
  }

  // Past the guard above the form only renders with a token.
  const linkToken: string = token;
  const clientErrors = validateResetPassword(values);
  const pending = resetPassword.isPending;

  function visibleError(name: ResetPasswordField): string | undefined {
    // Client errors appear after the first submit attempt (not on blur): an error that shows up
    // while the pointer is moving to the button would shift it and swallow the click.
    const clientError = submitted ? clientErrors[name] : undefined;

    return clientError ?? serverErrors[name];
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const name = event.target.name as ResetPasswordField;

    setValues((current) => ({ ...current, [name]: event.target.value }));
    setServerErrors((current) => ({ ...current, [name]: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setGeneralError(undefined);
    setServerErrors({});

    const invalid = firstInvalid(clientErrors);

    if (invalid) {
      focusField(invalid);
      return;
    }

    resetPassword.mutate(
      { token: linkToken, ...values },
      {
        onError: (error) => {
          const failure = describeResetPasswordFailure(error);

          if (failure.linkInvalid) {
            setLinkInvalid(true);
            return;
          }

          setServerErrors(failure.fieldErrors);
          setGeneralError(failure.general);

          const invalidField = firstInvalid(failure.fieldErrors);

          if (invalidField) {
            focusField(invalidField);
          }
        },
      },
    );
  }

  function renderField(name: ResetPasswordField) {
    const inputId = `reset-password-${name}`;
    const errorId = `${inputId}-error`;
    const error = visibleError(name);

    return (
      <div key={name} className="space-y-2">
        <Label htmlFor={inputId}>{FIELDS[name].label}</Label>
        <PasswordInput
          id={inputId}
          name={name}
          visibilityLabel={FIELDS[name].visibilityLabel}
          autoComplete="new-password"
          value={values[name]}
          onChange={handleChange}
          readOnly={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          required
        />
        {error ? (
          <p id={errorId} className="text-base font-bold text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">Choose a new password</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Use 8 to 128 characters. We will sign you out everywhere once it is changed.
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

        {renderField("password")}
        {renderField("confirmPassword")}

        <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Spinner />
              Resetting…
            </>
          ) : (
            "Reset password"
          )}
        </Button>
      </form>

      <p className="mt-6 text-base">
        <Link to="/auth/sign-in" className={LINK_CLASS}>
          Back to sign in
        </Link>
      </p>
    </section>
  );
}
