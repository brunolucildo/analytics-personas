import { Link } from "@tanstack/react-router";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { PasswordInput } from "@repo/ui/password-input";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { describeSignUpFailure } from "./describe-sign-up-failure";
import {
  EMPTY_SIGN_UP_VALUES,
  SIGN_UP_FIELDS,
  validateSignUp,
  type SignUpErrors,
  type SignUpField,
  type SignUpValues,
} from "./sign-up-validation";
import { useSignUp } from "./use-sign-up";

interface FieldConfig {
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  /** Only for password fields: what the show/hide toggle reveals, used in its accessible name. */
  visibilityLabel?: string;
}

const FIELDS: Record<SignUpField, FieldConfig> = {
  firstName: { label: "First name", type: "text", autoComplete: "given-name" },
  lastName: { label: "Last name", type: "text", autoComplete: "family-name" },
  email: { label: "Email", type: "email", autoComplete: "email" },
  password: {
    label: "Password",
    type: "password",
    autoComplete: "new-password",
    visibilityLabel: "password",
  },
  confirmPassword: {
    label: "Confirm password",
    type: "password",
    autoComplete: "new-password",
    visibilityLabel: "password confirmation",
  },
};

const CARD_CLASS = "border-2 border-border bg-card p-6 shadow-[4px_4px_0_0_var(--color-border)]";
const LINK_CLASS =
  "inline-flex min-h-11 items-center font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function focusField(name: SignUpField) {
  document.getElementById(`sign-up-${name}`)?.focus();
}

function firstInvalid(errors: SignUpErrors): SignUpField | undefined {
  return SIGN_UP_FIELDS.find((name) => errors[name] !== undefined);
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

export function SignUpPage() {
  const signUp = useSignUp();
  const [values, setValues] = useState<SignUpValues>(EMPTY_SIGN_UP_VALUES);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<SignUpErrors>({});
  const [emailTaken, setEmailTaken] = useState(false);
  const [generalError, setGeneralError] = useState<string>();

  if (signUp.isSuccess) {
    return (
      <section className={CARD_CLASS}>
        <h1
          ref={(element) => element?.focus()}
          tabIndex={-1}
          className="text-3xl font-black tracking-tight focus-visible:outline-none"
        >
          Check your email
        </h1>
        <p className="mt-4 text-base">
          We sent a confirmation link to <strong className="break-all">{signUp.data.email}</strong>.
          Open it to confirm your account. The link expires in 24 hours.
        </p>
        <p className="mt-6 text-base">
          Already confirmed?{" "}
          <Link to="/auth/sign-in" className={LINK_CLASS}>
            Sign in
          </Link>
        </p>
      </section>
    );
  }

  const clientErrors = validateSignUp(values);
  const pending = signUp.isPending;

  function visibleError(name: SignUpField): string | undefined {
    // Client errors appear after the first submit attempt (not on blur): an error that shows up
    // while the pointer is moving to the button would shift it and swallow the click.
    const clientError = submitted ? clientErrors[name] : undefined;

    return clientError ?? serverErrors[name];
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const name = event.target.name as SignUpField;

    setValues((current) => ({ ...current, [name]: event.target.value }));
    setServerErrors((current) => ({ ...current, [name]: undefined }));

    if (name === "email") {
      setEmailTaken(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setGeneralError(undefined);
    setServerErrors({});
    setEmailTaken(false);

    const invalid = firstInvalid(clientErrors);

    if (invalid) {
      focusField(invalid);
      return;
    }

    signUp.mutate(values, {
      onError: (error) => {
        const failure = describeSignUpFailure(error);

        setServerErrors(failure.fieldErrors);
        setEmailTaken(failure.emailTaken);
        setGeneralError(failure.general);

        const invalidField = firstInvalid(failure.fieldErrors);

        if (invalidField) {
          focusField(invalidField);
        }
      },
    });
  }

  function renderField(name: SignUpField) {
    const field = FIELDS[name];
    const inputId = `sign-up-${name}`;
    const errorId = `${inputId}-error`;
    const error = visibleError(name);

    return (
      <div key={name} className="space-y-2">
        <Label htmlFor={inputId}>{field.label}</Label>
        {field.type === "password" ? (
          <PasswordInput
            id={inputId}
            name={name}
            visibilityLabel={field.visibilityLabel}
            autoComplete={field.autoComplete}
            value={values[name]}
            onChange={handleChange}
            readOnly={pending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            required
          />
        ) : (
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
        )}
        {error ? (
          <p id={errorId} className="text-base font-bold text-destructive">
            {error}
            {name === "email" && emailTaken ? (
              <>
                {" "}
                <Link to="/auth/sign-in" className={LINK_CLASS}>
                  Sign in
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className={CARD_CLASS}>
      <h1 className="text-3xl font-black tracking-tight">Create your account</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Use your email to get started. We will ask you to confirm it.
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

        <div className="grid gap-5 sm:grid-cols-2">
          {renderField("firstName")}
          {renderField("lastName")}
        </div>
        {renderField("email")}
        {renderField("password")}
        {renderField("confirmPassword")}

        <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
          {pending ? (
            <>
              <Spinner />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      <p className="mt-6 text-base">
        Already have an account?{" "}
        <Link to="/auth/sign-in" className={LINK_CLASS}>
          Sign in
        </Link>
      </p>
    </section>
  );
}
