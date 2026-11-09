import type { EmailMessage } from "./email-message";

/**
 * Port implemented by each delivery backend (Mailtrap, Resend, capture).
 * Implementations throw `EmailDeliveryError` and must honour `signal`.
 */
export interface EmailProvider {
  readonly name: string;
  deliver(message: EmailMessage, signal: AbortSignal): Promise<void>;
}
