import type { EmailAddress } from "../domain/email-message";

export const EMAIL_PROVIDER_NAMES = ["mailtrap", "resend", "capture"] as const;

export type EmailProviderName = (typeof EMAIL_PROVIDER_NAMES)[number];

export type EmailConfig =
  | { provider: "capture"; from: EmailAddress }
  | { provider: "mailtrap"; from: EmailAddress; apiToken: string; inboxId: string }
  | { provider: "resend"; from: EmailAddress; apiKey: string };

const ADDRESS_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NAMED_ADDRESS_PATTERN = /^\s*"?([^"<>]+?)"?\s*<([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+)>\s*$/;

/** Accepts `user@host` or `Display Name <user@host>`. */
export function parseEmailFrom(value: string | undefined): EmailAddress {
  const trimmed = value?.trim() ?? "";

  if (ADDRESS_PATTERN.test(trimmed)) {
    return { address: trimmed };
  }

  const named = NAMED_ADDRESS_PATTERN.exec(trimmed);

  if (named?.[1] && named[2]) {
    return { name: named[1].trim(), address: named[2] };
  }

  throw new Error(
    'EMAIL_FROM must be an e-mail address, optionally with a name, for example "Analytics Personas <no-reply@example.com>".',
  );
}

function requireVariable(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required when EMAIL_PROVIDER is "${env.EMAIL_PROVIDER?.trim()}".`);
  }

  return value;
}

/**
 * Validates the e-mail variables at boot. Errors name the variable and never
 * echo credential values.
 */
export function parseEmailConfig(env: Record<string, string | undefined>): EmailConfig {
  const provider = env.EMAIL_PROVIDER?.trim();

  if (!provider || !(EMAIL_PROVIDER_NAMES as readonly string[]).includes(provider)) {
    throw new Error(
      `EMAIL_PROVIDER must be one of ${EMAIL_PROVIDER_NAMES.join(", ")} (mailtrap outside production, resend in production, capture in automated tests).`,
    );
  }

  if (env.NODE_ENV === "production" && provider !== "resend") {
    throw new Error('EMAIL_PROVIDER must be "resend" when NODE_ENV is production.');
  }

  const from = parseEmailFrom(env.EMAIL_FROM);

  switch (provider) {
    case "resend":
      return { provider, from, apiKey: requireVariable(env, "RESEND_API_KEY") };
    case "mailtrap": {
      const inboxId = requireVariable(env, "MAILTRAP_INBOX_ID");

      if (!/^\d+$/.test(inboxId)) {
        throw new Error("MAILTRAP_INBOX_ID must be the numeric id of the Mailtrap inbox.");
      }

      return {
        provider,
        from,
        apiToken: requireVariable(env, "MAILTRAP_API_TOKEN"),
        inboxId,
      };
    }
    default:
      return { provider: "capture", from };
  }
}
