import { createClient } from "@supabase/supabase-js";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import type { Environment } from "../../config/environment";
import { createInstrumentedFetch } from "../../observability/db-telemetry";
import { EmailModule, EmailService } from "../email";
import { ConfirmAccount } from "./application/use-cases/confirm-account.use-case";
import { GetSession } from "./application/use-cases/get-session.use-case";
import { RequestPasswordReset } from "./application/use-cases/request-password-reset.use-case";
import { ResendConfirmation } from "./application/use-cases/resend-confirmation.use-case";
import { ResetPassword } from "./application/use-cases/reset-password.use-case";
import { SessionService } from "./application/services/session.service";
import { SignIn } from "./application/use-cases/sign-in.use-case";
import { SignOut } from "./application/use-cases/sign-out.use-case";
import { SignUp } from "./application/use-cases/sign-up.use-case";
import type {
  ConfirmationMailer,
  PasswordHasher,
  TokenGenerator,
  TokenHasher,
  UserRepository,
} from "./domain/auth-ports";
import type { ConfirmationRepository } from "./domain/confirm-account-ports";
import type {
  PasswordChangedMailer,
  PasswordResetMailer,
  PasswordResetRepository,
} from "./domain/password-reset-ports";
import type { AccessTokenSigner, SessionRepository } from "./domain/session-ports";
import type {
  CredentialsRepository,
  NewSessionMailer,
  PasswordVerifier,
} from "./domain/sign-in-ports";
import {
  CONFIRMATION_MAILER,
  CONFIRMATION_REPOSITORY,
  CREDENTIALS_REPOSITORY,
  NEW_SESSION_MAILER,
  PASSWORD_CHANGED_MAILER,
  HASH_LIMITER,
  PASSWORD_HASHER,
  PASSWORD_RESET_MAILER,
  PASSWORD_RESET_REPOSITORY,
  PASSWORD_VERIFIER,
  SUPABASE_ADMIN_CLIENT,
  TOKEN_GENERATOR,
  TOKEN_HASHER,
  USER_REPOSITORY,
} from "./auth.tokens";
import { ACCESS_TOKEN_SIGNER, SESSION_REPOSITORY } from "./session.tokens";
import { Argon2PasswordHasher } from "./infrastructure/argon2-password-hasher";
import { Argon2PasswordVerifier } from "./infrastructure/argon2-password-verifier";
import { HashLimiter } from "./infrastructure/hash-limiter";
import { CryptoTokenGenerator } from "./infrastructure/crypto-token-generator";
import { CryptoTokenHasher } from "./infrastructure/crypto-token-hasher";
import { EmailServiceConfirmationMailer } from "./infrastructure/email-service-confirmation-mailer";
import { EmailServiceNewSessionMailer } from "./infrastructure/email-service-new-session-mailer";
import { EmailServicePasswordChangedMailer } from "./infrastructure/email-service-password-changed-mailer";
import { EmailServicePasswordResetMailer } from "./infrastructure/email-service-password-reset-mailer";
import { SupabaseCredentialsRepository } from "./infrastructure/supabase-credentials.repository";
import { SupabaseConfirmationRepository } from "./infrastructure/supabase-confirmation.repository";
import { SupabasePasswordResetRepository } from "./infrastructure/supabase-password-reset.repository";
import { JoseAccessTokenSigner } from "./infrastructure/jose-access-token-signer";
import { SupabaseSessionRepository } from "./infrastructure/supabase-session.repository";
import { SupabaseUserRepository } from "./infrastructure/supabase-user.repository";
import { AuthGuard } from "./interface/guards/auth.guard";
import { ConfirmAccountRequestHandler } from "./interface/request-handlers/confirm-account.request-handler";
import { ForgotPasswordRequestHandler } from "./interface/request-handlers/forgot-password.request-handler";
import { GetSessionRequestHandler } from "./interface/request-handlers/get-session.request-handler";
import { ResendConfirmationRequestHandler } from "./interface/request-handlers/resend-confirmation.request-handler";
import { ResetPasswordRequestHandler } from "./interface/request-handlers/reset-password.request-handler";
import { SignInRequestHandler } from "./interface/request-handlers/sign-in.request-handler";
import { SignOutRequestHandler } from "./interface/request-handlers/sign-out.request-handler";
import { SignUpRequestHandler } from "./interface/request-handlers/sign-up.request-handler";

@Module({
  imports: [EmailModule],
  controllers: [
    SignUpRequestHandler,
    ForgotPasswordRequestHandler,
    ResetPasswordRequestHandler,
    SignInRequestHandler,
    SignOutRequestHandler,
    ConfirmAccountRequestHandler,
    ResendConfirmationRequestHandler,
    GetSessionRequestHandler,
  ],
  providers: [
    {
      // Service role: server only. It bypasses RLS, which is why the tables have no policies.
      provide: SUPABASE_ADMIN_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        createClient(
          config.get("supabaseUrl", { infer: true }),
          config.get("supabaseServiceRoleKey", { infer: true }),
          {
            auth: { persistSession: false, autoRefreshToken: false },
            // One span and one histogram point per Postgres call, with no query string or body.
            global: { fetch: createInstrumentedFetch() },
          },
        ),
    },
    {
      provide: USER_REPOSITORY,
      inject: [SUPABASE_ADMIN_CLIENT],
      useFactory: (client: ConstructorParameters<typeof SupabaseUserRepository>[0]) =>
        new SupabaseUserRepository(client),
    },
    {
      // One budget for every argon2 call of the process (hash and verify).
      provide: HASH_LIMITER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new HashLimiter({
          concurrency: config.get("authHashConcurrency", { infer: true }),
          maxQueue: config.get("authHashQueueLimit", { infer: true }),
        }),
    },
    {
      provide: PASSWORD_HASHER,
      inject: [HASH_LIMITER],
      useFactory: (limiter: HashLimiter) => new Argon2PasswordHasher(limiter),
    },
    { provide: TOKEN_GENERATOR, useClass: CryptoTokenGenerator },
    { provide: TOKEN_HASHER, useClass: CryptoTokenHasher },
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
    {
      provide: SignOut,
      inject: [SessionService],
      useFactory: (sessions: SessionService) => new SignOut(sessions),
    },
    {
      provide: CONFIRMATION_REPOSITORY,
      inject: [SUPABASE_ADMIN_CLIENT],
      useFactory: (client: ConstructorParameters<typeof SupabaseConfirmationRepository>[0]) =>
        new SupabaseConfirmationRepository(client),
    },
    {
      provide: ResendConfirmation,
      inject: [CONFIRMATION_REPOSITORY, TOKEN_GENERATOR, CONFIRMATION_MAILER],
      useFactory: (
        confirmations: ConfirmationRepository,
        tokens: TokenGenerator,
        mailer: ConfirmationMailer,
      ) => new ResendConfirmation(confirmations, tokens, mailer),
    },
    {
      provide: ConfirmAccount,
      inject: [CONFIRMATION_REPOSITORY, SessionService, TOKEN_HASHER],
      useFactory: (
        confirmations: ConfirmationRepository,
        sessions: SessionService,
        tokenHasher: TokenHasher,
      ) => new ConfirmAccount(confirmations, sessions, tokenHasher),
    },
    {
      provide: CREDENTIALS_REPOSITORY,
      inject: [SUPABASE_ADMIN_CLIENT],
      useFactory: (client: ConstructorParameters<typeof SupabaseCredentialsRepository>[0]) =>
        new SupabaseCredentialsRepository(client),
    },
    {
      provide: PASSWORD_VERIFIER,
      inject: [HASH_LIMITER],
      useFactory: (limiter: HashLimiter) => new Argon2PasswordVerifier(limiter),
    },
    {
      provide: NEW_SESSION_MAILER,
      inject: [EmailService, ConfigService],
      useFactory: (emails: EmailService, config: ConfigService<Environment, true>) =>
        new EmailServiceNewSessionMailer(emails, config.get("appUrl", { infer: true })),
    },
    {
      provide: SignIn,
      inject: [CREDENTIALS_REPOSITORY, PASSWORD_VERIFIER, SessionService, NEW_SESSION_MAILER],
      useFactory: (
        credentials: CredentialsRepository,
        verifier: PasswordVerifier,
        sessions: SessionService,
        mailer: NewSessionMailer,
      ) => new SignIn(credentials, verifier, sessions, mailer),
    },
    {
      provide: PASSWORD_CHANGED_MAILER,
      inject: [EmailService, ConfigService],
      useFactory: (emails: EmailService, config: ConfigService<Environment, true>) =>
        new EmailServicePasswordChangedMailer(emails, config.get("appUrl", { infer: true })),
    },
    {
      provide: ResetPassword,
      inject: [PASSWORD_RESET_REPOSITORY, PASSWORD_HASHER, PASSWORD_CHANGED_MAILER, TOKEN_HASHER],
      useFactory: (
        resets: PasswordResetRepository,
        hasher: PasswordHasher,
        mailer: PasswordChangedMailer,
        tokenHasher: TokenHasher,
      ) => new ResetPassword(resets, hasher, mailer, tokenHasher),
    },
    { provide: GetSession, useFactory: () => new GetSession() },
    // Global guard: closes every route that is not `@Public()`. It is registered here, after
    // `RateLimitModule` in `AppModule`, so the rate limit still runs before authentication.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
