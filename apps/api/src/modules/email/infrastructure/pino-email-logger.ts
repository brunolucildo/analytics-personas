import { baseLogger } from "../../../observability/logger";
import type { EmailLogger } from "../application/email.service";

/** Writes the structured, PII-free e-mail events to the service logger. */
export const pinoEmailLogger: EmailLogger = {
  info: (fields, message) => baseLogger.info(fields, message),
  error: (fields, message) => baseLogger.error(fields, message),
};
