import type {
  PasswordResetEmail,
  PasswordResetMailer,
  PasswordResetRepository,
  PasswordResetToken,
  RequestPasswordResetResult,
} from "../../src/modules/auth/domain/password-reset-ports";

export interface FakeAccount {
  email: string;
  firstName: string;
  confirmed: boolean;
}

/** In-memory `PasswordResetRepository` for unit tests: same contract as the Supabase one. */
export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  readonly tokens: Array<PasswordResetToken & { email: string; used: boolean }> = [];

  constructor(private readonly accounts: FakeAccount[]) {}

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
