/** Public surface of the e-mail module: other modules import only from here. */
export { EmailService } from "./application/email.service";
export {
  type EmailLayoutInput,
  type RenderedEmail,
  renderEmailLayout,
} from "./application/render-email-layout";
export { EmailDeliveryError, type EmailDeliveryErrorCode } from "./domain/email-delivery-error";
export type { EmailMessage } from "./domain/email-message";
export { escapeHtml, html, SafeHtml } from "./domain/safe-html";
export { EmailModule } from "./email.module";
export {
  type CapturedEmail,
  clearCapturedEmails,
  getCapturedEmails,
} from "./infrastructure/capture/captured-email-store";
export { type EmailConfig, parseEmailConfig } from "./infrastructure/email-config";
