/** Public surface of the e-mail module: other modules import only from here. */
export { EmailService } from "./application/email.service";
export {
  type EmailLayoutInput,
  type RenderedEmail,
  renderEmailLayout,
} from "./application/render-email-layout";
export { EmailDeliveryError, type EmailDeliveryErrorCode } from "./domain/email-delivery-error";
export { type EmailConfig, parseEmailConfig } from "./domain/email-config";
export type { EmailMessage } from "./domain/email-message";
export { escapeHtml, html, SafeHtml } from "./domain/safe-html";
export { EmailModule } from "./email.module";
