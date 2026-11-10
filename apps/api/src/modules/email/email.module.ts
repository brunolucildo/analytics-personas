import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment";
import { EmailService } from "./application/email.service";
import type { EmailProvider } from "./domain/email-provider";
import { EMAIL_CONFIG, EMAIL_PROVIDER } from "./email.tokens";
import {
  capturedEmailStore,
  CapturedEmailStore,
} from "./infrastructure/capture/captured-email-store";
import { createEmailProvider } from "./infrastructure/create-email-provider";
import type { EmailConfig } from "./infrastructure/email-config";
import { pinoEmailLogger } from "./infrastructure/pino-email-logger";
import {
  CaptureOnlyGuard,
  TestSupportEmailsController,
} from "./interface/test-support-emails.controller";

@Module({
  controllers: [TestSupportEmailsController],
  providers: [
    CaptureOnlyGuard,
    {
      provide: EMAIL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): EmailConfig =>
        config.get("email", { infer: true }),
    },
    { provide: CapturedEmailStore, useValue: capturedEmailStore },
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
