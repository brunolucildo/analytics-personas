import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Public } from "../../../../common/public.decorator";
import { ListCapturedEmails } from "../../application/use-cases/list-captured-emails.use-case";
import type { CapturedEmail } from "../../domain/captured-emails-ports";
import { CaptureOnlyGuard } from "../guards/capture-only.guard";

/** Test support: lets E2E tests (a separate process) read captured e-mails. */
@Controller("test-support/emails")
// Open to the session guard on purpose: `CaptureOnlyGuard` answers 404 unless the `capture` provider is on.
@Public()
@UseGuards(CaptureOnlyGuard)
export class ListCapturedEmailsRequestHandler {
  constructor(
    @Inject(ListCapturedEmails) private readonly listCapturedEmails: ListCapturedEmails,
  ) {}

  @Get()
  handle(@Query("to") to?: string): { emails: CapturedEmail[] } {
    return { emails: this.listCapturedEmails.execute({ to }) };
  }
}
