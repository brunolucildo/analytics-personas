import { createClient } from "@supabase/supabase-js";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import type { Environment } from "../../config/environment";
import { EmailModule, EmailService } from "../email";
import { SessionService } from "./application/session.service";
import { SignUp } from "./application/sign-up";
import type {
  ConfirmationMailer,
  PasswordHasher,
  TokenGenerator,
  UserRepository,
} from "./domain/auth-ports";
import type { AccessTokenSigner, SessionRepository } from "./domain/session-ports";
import {
  CONFIRMATION_MAILER,
  PASSWORD_HASHER,
  SUPABASE_ADMIN_CLIENT,
  TOKEN_GENERATOR,
  USER_REPOSITORY,
} from "./auth.tokens";
import { ACCESS_TOKEN_SIGNER, SESSION_REPOSITORY } from "./session.tokens";
import { Argon2PasswordHasher } from "./infrastructure/argon2-password-hasher";
import { CryptoTokenGenerator } from "./infrastructure/crypto-token-generator";
import { EmailServiceConfirmationMailer } from "./infrastructure/email-service-confirmation-mailer";
import { JoseAccessTokenSigner } from "./infrastructure/jose-access-token-signer";
import { SupabaseSessionRepository } from "./infrastructure/supabase-session.repository";
import { SupabaseUserRepository } from "./infrastructure/supabase-user.repository";
import { AuthController } from "./interface/auth.controller";
import { AuthGuard } from "./interface/auth.guard";

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
      provide: SESSION_REPOSITORY,
      inject: [SUPABASE_ADMIN_CLIENT],
      useFactory: (client: ConstructorParameters<typeof SupabaseSessionRepository>[0]) =>
        new SupabaseSessionRepository(client),
    },
    {
      provide: ACCESS_TOKEN_SIGNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new JoseAccessTokenSigner(config.get("authJwtSecret", { infer: true })),
    },
    {
      provide: SessionService,
      inject: [SESSION_REPOSITORY, ACCESS_TOKEN_SIGNER],
      useFactory: (sessions: SessionRepository, signer: AccessTokenSigner) =>
        new SessionService(sessions, signer),
    },
    // Global guard: closes every route that is not `@Public()`. It is registered here, after
    // `RateLimitModule` in `AppModule`, so the rate limit still runs before authentication.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
