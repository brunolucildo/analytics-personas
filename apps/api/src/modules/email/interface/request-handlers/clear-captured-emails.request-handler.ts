import { Controller, Delete, HttpCode, Inject, UseGuards } from "@nestjs/common";
import { Public } from "../../../../common/public.decorator";
import { ClearCapturedEmails } from "../../application/use-cases/clear-captured-emails.use-case";
import { CaptureOnlyGuard } from "../guards/capture-only.guard";

/** Test support: lets E2E tests empty the captured mailbox between scenarios. */
@Controller("test-support/emails")
// Open to the session guard on purpose: `CaptureOnlyGuard` answers 404 unless the `capture` provider is on.
@Public()
@UseGuards(CaptureOnlyGuard)
export class ClearCapturedEmailsRequestHandler {
  constructor(
    @Inject(ClearCapturedEmails) private readonly clearCapturedEmails: ClearCapturedEmails,
  ) {}

  @Delete()
  @HttpCode(204)
  handle(): void {
    this.clearCapturedEmails.execute();
  }
}
