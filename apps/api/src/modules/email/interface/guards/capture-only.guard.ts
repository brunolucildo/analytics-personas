import { type CanActivate, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { EMAIL_CONFIG } from "../../email.tokens";
import type { EmailConfig } from "../../domain/email-config";

/**
 * Answers 404 (same envelope as an unknown route) unless the `capture`
 * provider is active. The API also refuses to boot with `capture` in
 * production, so this route cannot be reached there.
 */
@Injectable()
export class CaptureOnlyGuard implements CanActivate {
  constructor(@Inject(EMAIL_CONFIG) private readonly config: EmailConfig) {}

  canActivate(): boolean {
    if (this.config.provider !== "capture") {
      throw new NotFoundException();
    }

    return true;
  }
}
