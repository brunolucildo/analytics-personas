import {
  type CanActivate,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Public } from "../../../common/public.decorator";
import { EMAIL_CONFIG } from "../email.tokens";
import {
  type CapturedEmail,
  CapturedEmailStore,
} from "../infrastructure/capture/captured-email-store";
import type { EmailConfig } from "../infrastructure/email-config";

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

/** Test support: lets E2E tests (a separate process) read captured e-mails. */
@Controller("test-support/emails")
// Open to the session guard on purpose: `CaptureOnlyGuard` answers 404 unless the `capture` provider is on.
@Public()
@UseGuards(CaptureOnlyGuard)
export class TestSupportEmailsController {
  constructor(@Inject(CapturedEmailStore) private readonly store: CapturedEmailStore) {}

  @Get()
  list(@Query("to") to?: string): { emails: CapturedEmail[] } {
    return { emails: this.store.list({ to }) };
  }

  @Delete()
  @HttpCode(204)
  clear(): void {
    this.store.clear();
  }
}
