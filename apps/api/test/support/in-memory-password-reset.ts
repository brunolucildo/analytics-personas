import type {
  PasswordChangedEmail,
  PasswordChangedMailer,
  PasswordResetEmail,
  PasswordResetMailer,
  PasswordResetOwner,
  PasswordResetRepository,
  PasswordResetToken,
  RequestPasswordResetResult,
} from "../../src/modules/auth/domain/password-reset-ports";

export interface FakeAccount {
  email: string;
  firstName: string;
  confirmed: boolean;
  /** Set by a reset (spec 0010). */
  passwordHash?: string;
}

/** In-memory `PasswordResetRepository` for unit tests: same contract as the Supabase one. */
export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  readonly tokens: Array<PasswordResetToken & { email: string; used: boolean }> = [];

  /** E-mails whose sessions a reset revoked. */
  readonly revokedSessionsOf: string[] = [];

  constructor(
    private readonly accounts: FakeAccount[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  resetByTokenHash(tokenHash: string, passwordHash: string): Promise<PasswordResetOwner | null> {
    const token = this.tokens.find(
      (stored) => stored.tokenHash === tokenHash && !stored.used && stored.expiresAt > this.now(),
    );
    const account = this.accounts.find((stored) => stored.email === token?.email);

    if (token === undefined || account === undefined) {
      return Promise.resolve(null);
    }

    for (const stored of this.tokens) {
      if (stored.email === account.email) {
        stored.used = true;
      }
    }

    account.passwordHash = passwordHash;
    this.revokedSessionsOf.push(account.email);

    return Promise.resolve({
      userId: `user:${account.email}`,
      firstName: account.firstName,
      email: account.email,
    });
  }

  createForConfirmedUser(
    email: string,
    token: PasswordResetToken,
  ): Promise<RequestPasswordResetResult> {
    const account = this.accounts.find((stored) => stored.email === email && stored.confirmed);

    if (!account) {
      return Promise.resolve({ status: "no_action" });
    }

    for (const stored of this.tokens) {
      if (stored.email === email) {
        stored.used = true;
      }
    }

    this.tokens.push({ ...token, email, used: false });

    return Promise.resolve({ status: "created", firstName: account.firstName });
  }
}

export class RecordingPasswordResetMailer implements PasswordResetMailer {
  readonly sent: PasswordResetEmail[] = [];

  sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    this.sent.push(email);

    return Promise.resolve();
  }
}

export class RecordingPasswordChangedMailer implements PasswordChangedMailer {
  readonly sent: PasswordChangedEmail[] = [];

  sendPasswordChanged(email: PasswordChangedEmail): Promise<void> {
    this.sent.push(email);

    return Promise.resolve();
  }
}
