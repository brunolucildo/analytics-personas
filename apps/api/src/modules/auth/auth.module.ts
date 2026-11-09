import { createClient } from "@supabase/supabase-js";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment";
import { EmailModule, EmailService } from "../email";
import { RequestPasswordReset } from "./application/request-password-reset";
import { SignUp } from "./application/sign-up";
import type {
  ConfirmationMailer,
  PasswordHasher,
  TokenGenerator,
  UserRepository,
} from "./domain/auth-ports";
import type { PasswordResetMailer, PasswordResetRepository } from "./domain/password-reset-ports";
import {
  CONFIRMATION_MAILER,
  PASSWORD_HASHER,
  PASSWORD_RESET_MAILER,
  PASSWORD_RESET_REPOSITORY,
  SUPABASE_ADMIN_CLIENT,
  TOKEN_GENERATOR,
  USER_REPOSITORY,
} from "./auth.tokens";
import { Argon2PasswordHasher } from "./infrastructure/argon2-password-hasher";
import { CryptoTokenGenerator } from "./infrastructure/crypto-token-generator";
import { EmailServiceConfirmationMailer } from "./infrastructure/email-service-confirmation-mailer";
import { EmailServicePasswordResetMailer } from "./infrastructure/email-service-password-reset-mailer";
import { SupabasePasswordResetRepository } from "./infrastructure/supabase-password-reset.repository";
import { SupabaseUserRepository } from "./infrastructure/supabase-user.repository";
import { AuthController } from "./interface/auth.controller";

@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    {
      // Service role: server only. It bypasses RLS, which is why the tables have no policies.
      provide: SUPABASE_ADMIN_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        createClient(
          config.get("supabaseUrl", { infer: true }),
          config.get("supabaseServiceRoleKey", { infer: true }),
          { auth: { persistSession: false, autoRefreshToken: false } },
        ),
    },
    {
      provide: USER_REPOSITORY,
      inject: [SUPABASE_ADMIN_CLIENT],
      useFactory: (client: ConstructorParameters<typeof SupabaseUserRepository>[0]) =>
        new SupabaseUserRepository(client),
    },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_GENERATOR, useClass: CryptoTokenGenerator },
    {
      provide: CONFIRMATION_MAILER,
      inject: [EmailService, ConfigService],
      useFactory: (emails: EmailService, config: ConfigService<Environment, true>) =>
        new EmailServiceConfirmationMailer(emails, config.get("appUrl", { infer: true })),
    },
    {
      provide: SignUp,
      inject: [USER_REPOSITORY, PASSWORD_HASHER, TOKEN_GENERATOR, CONFIRMATION_MAILER],
      useFactory: (
        users: UserRepository,
        hasher: PasswordHasher,
        tokens: TokenGenerator,
        mailer: ConfirmationMailer,
      ) => new SignUp(users, hasher, tokens, mailer),
    },
    {
      provide: PASSWORD_RESET_REPOSITORY,
      inject: [SUPABASE_ADMIN_CLIENT],
      useFactory: (client: ConstructorParameters<typeof SupabasePasswordResetRepository>[0]) =>
        new SupabasePasswordResetRepository(client),
    },
    {
      provide: PASSWORD_RESET_MAILER,
      inject: [EmailService, ConfigService],
      useFactory: (emails: EmailService, config: ConfigService<Environment, true>) =>
        new EmailServicePasswordResetMailer(emails, config.get("appUrl", { infer: true })),
    },
    {
      provide: RequestPasswordReset,
      inject: [PASSWORD_RESET_REPOSITORY, TOKEN_GENERATOR, PASSWORD_RESET_MAILER],
      useFactory: (
        resets: PasswordResetRepository,
        tokens: TokenGenerator,
        mailer: PasswordResetMailer,
      ) => new RequestPasswordReset(resets, tokens, mailer),
    },
  ],
})
export class AuthModule {}
