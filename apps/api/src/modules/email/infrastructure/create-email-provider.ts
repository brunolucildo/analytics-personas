import type { EmailProvider } from "../domain/email-provider";
import { CaptureEmailProvider } from "./capture/capture-email-provider";
import type { CapturedEmailStore } from "./capture/captured-email-store";
import type { EmailConfig } from "./email-config";
import { MailtrapEmailProvider } from "./mailtrap/mailtrap-email-provider";
import { ResendEmailProvider } from "./resend/resend-email-provider";

/** Builds the one provider selected by `EMAIL_PROVIDER`; the others are never constructed. */
export function createEmailProvider(config: EmailConfig, store: CapturedEmailStore): EmailProvider {
  switch (config.provider) {
    case "mailtrap":
      return new MailtrapEmailProvider(config);
    case "resend":
      return new ResendEmailProvider(config);
    case "capture":
      return new CaptureEmailProvider(config.from, store);
  }
}
