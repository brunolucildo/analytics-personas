import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment";
import { EmailService } from "./application/email.service";
import { ClearCapturedEmails } from "./application/use-cases/clear-captured-emails.use-case";
import { ListCapturedEmails } from "./application/use-cases/list-captured-emails.use-case";
import type { CapturedEmailRepository } from "./domain/captured-emails-ports";
import type { EmailConfig } from "./domain/email-config";
import type { EmailProvider } from "./domain/email-provider";
import { CAPTURED_EMAIL_REPOSITORY, EMAIL_CONFIG, EMAIL_PROVIDER } from "./email.tokens";
import {
  capturedEmailStore,
  CapturedEmailStore,
} from "./infrastructure/capture/captured-email-store";
import { createEmailProvider } from "./infrastructure/create-email-provider";
import { pinoEmailLogger } from "./infrastructure/pino-email-logger";
import { CaptureOnlyGuard } from "./interface/guards/capture-only.guard";
import { ClearCapturedEmailsRequestHandler } from "./interface/request-handlers/clear-captured-emails.request-handler";
import { ListCapturedEmailsRequestHandler } from "./interface/request-handlers/list-captured-emails.request-handler";

@Module({
  controllers: [ListCapturedEmailsRequestHandler, ClearCapturedEmailsRequestHandler],
  providers: [
    CaptureOnlyGuard,
    {
      provide: EMAIL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): EmailConfig =>
        config.get("email", { infer: true }),
    },
    // One mailbox shared by the capture provider and the test-support routes.
    { provide: CapturedEmailStore, useValue: capturedEmailStore },
    { provide: CAPTURED_EMAIL_REPOSITORY, useValue: capturedEmailStore },
    {
      provide: ListCapturedEmails,
      inject: [CAPTURED_EMAIL_REPOSITORY],
      useFactory: (emails: CapturedEmailRepository) => new ListCapturedEmails(emails),
    },
    {
      provide: ClearCapturedEmails,
      inject: [CAPTURED_EMAIL_REPOSITORY],
      useFactory: (emails: CapturedEmailRepository) => new ClearCapturedEmails(emails),
    },
    {
      provide: EMAIL_PROVIDER,
      inject: [EMAIL_CONFIG, CapturedEmailStore],
      useFactory: createEmailProvider,
    },
    {
      provide: EmailService,
      inject: [EMAIL_PROVIDER],
      useFactory: (provider: EmailProvider) => new EmailService(provider, pinoEmailLogger),
    },
  ],
  exports: [EmailService],
})
export class EmailModule implements OnApplicationShutdown {
  constructor(@Inject(EmailService) private readonly emailService: EmailService) {}

  /** Lets e-mails already handed to `dispatch` finish before the process exits. */
  async onApplicationShutdown(): Promise<void> {
    await this.emailService.drain();
  }
}
