/**
 * Test surface of the e-mail module: the capture helpers and the injection tokens
 * that integration and E2E specs need. Production code imports the module barrel.
 */
export type { CapturedEmail } from "../domain/captured-emails-ports";
export { EMAIL_CONFIG, EMAIL_PROVIDER } from "../email.tokens";
export {
  clearCapturedEmails,
  getCapturedEmails,
} from "../infrastructure/capture/captured-email-store";
