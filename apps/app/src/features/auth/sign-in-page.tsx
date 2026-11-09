import { Link } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { describeSignInFailure } from "./describe-sign-in-failure";
import {
  EMPTY_SIGN_IN_VALUES,
  SIGN_IN_FIELDS,
  validateSignIn,
  type SignInErrors,
  type SignInField,
  type SignInValues,
} from "./sign-in-validation";
import { useRedirect } from "./use-redirect";
import { useSignIn } from "./use-sign-in";

interface FieldConfig {
  label: string;
  type: "email" | "password";
  autoComplete: string;
}

const FIELDS: Record<SignInField, FieldConfig> = {
  email: { label: "Email", type: "email", autoComplete: "email" },
  password: { label: "Password", type: "password", autoComplete: "current-password" },
};

const CARD_CLASS = "border-2 border-border bg-card p-6 shadow-[4px_4px_0_0_var(--color-border)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function focusField(name: SignInField) {
  document.getElementById(`sign-in-${name}`)?.focus();
}

function firstInvalid(errors: SignInErrors): SignInField | undefined {
  return SIGN_IN_FIELDS.find((name) => errors[name] !== undefined);
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

export function SignInPage() {
  const signIn = useSignIn();
  const [values, setValues] = useState<SignInValues>(EMPTY_SIGN_IN_VALUES);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<SignInErrors>({});
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [generalError, setGeneralError] = useState<string>();

  // Success only stores the token (in the hook); the page then leaves for the home.
  useRedirect(signIn.isSuccess ? "/app" : null);

  const clientErrors = validateSignIn(values);
  const pending = signIn.isPending;

  function visibleError(name: SignInField): string | undefined {
    // Client errors appear after the first submit attempt (not on blur): an error that shows up
    // while the pointer is moving to the button would shift it and swallow the click.
    const clientError = submitted ? clientErrors[name] : undefined;

    return clientError ?? serverErrors[name];
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const name = event.target.name as SignInField;

    setValues((current) => ({ ...current, [name]: event.target.value }));
    setServerErrors((current) => ({ ...current, [name]: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setGeneralError(undefined);
    setServerErrors({});
    setUnconfirmed(false);

    const invalid = firstInvalid(clientErrors);

    if (invalid) {
      focusField(invalid);
      return;
    }

    signIn.mutate(values, {
      onError: (error) => {
        const failure = describeSignInFailure(error);

        setServerErrors(failure.fieldErrors);
        setUnconfirmed(failure.unconfirmed);
        setGeneralError(failure.general);
        // A rejected password is never kept in the form.
        setValues((current) => ({ ...current, password: "" }));
        setSubmitted(false);
        focusField(firstInvalid(failure.fieldErrors) ?? "password");
      },
    });
  }

  function renderField(name: SignInField) {
    const field = FIELDS[name];
    const inputId = `sign-in-${name}`;
    const errorId = `${inputId}-error`;
    const error = visibleError(name);

    return (
      <div key={name} className="space-y-2">
        <Label htmlFor={inputId}>{field.label}</Label>
        <Input
          id={inputId}
          name={name}
          type={field.type}
          autoComplete={field.autoComplete}
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
      <h1 className="text-3xl font-black tracking-tight">Sign in</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Use the email and password of your account.
      </p>

      <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
        {generalError ? (
          <p
            role="alert"
            className="border-2 border-destructive bg-background p-3 text-base font-bold text-destructive"
          >
            {generalError}
            {unconfirmed ? (
              <>
                {" "}
                <Link to="/auth/resend-confirmation" className={LINK_CLASS}>
                  Resend confirmation email
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        {renderField("email")}
        {renderField("password")}

        <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Spinner />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="mt-6 text-base">
        <Link to="/auth/forgot-password" className={LINK_CLASS}>
          Forgot your password?
        </Link>
      </p>
      <p className="text-base">
        <Link to="/auth/sign-up" className={LINK_CLASS}>
          Create an account
        </Link>
      </p>
    </section>
  );
}
