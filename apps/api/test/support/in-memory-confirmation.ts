import type { ConfirmationToken } from "../../src/modules/auth/domain/auth-ports";
import type {
  ConfirmationRepository,
  RenewConfirmationResult,
} from "../../src/modules/auth/domain/confirm-account-ports";

export interface FakeConfirmationAccount {
  id: string;
  email: string;
  firstName: string;
  confirmed: boolean;
}

export interface FakeConfirmationToken extends ConfirmationToken {
  userId: string;
  used: boolean;
}

/** In-memory `ConfirmationRepository` for unit tests: same contract as the Supabase one. */
export class InMemoryConfirmationRepository implements ConfirmationRepository {
  readonly tokens: FakeConfirmationToken[] = [];

  constructor(
    private readonly accounts: FakeConfirmationAccount[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  confirmByTokenHash(tokenHash: string): Promise<string | null> {
    const token = this.tokens.find(
      (stored) => stored.tokenHash === tokenHash && !stored.used && stored.expiresAt > this.now(),
    );

    if (token === undefined) {
      return Promise.resolve(null);
    }

    token.used = true;

    const account = this.accounts.find((stored) => stored.id === token.userId);

    if (account !== undefined) {
      account.confirmed = true;
    }

    return Promise.resolve(token.userId);
  }

  renewForUnconfirmedUser(
    email: string,
    token: ConfirmationToken,
  ): Promise<RenewConfirmationResult> {
    const account = this.accounts.find((stored) => stored.email === email && !stored.confirmed);

    if (account === undefined) {
      return Promise.resolve({ status: "no_action" });
    }

    for (const stored of this.tokens) {
      if (stored.userId === account.id) {
        stored.used = true;
      }
    }

    this.tokens.push({ ...token, userId: account.id, used: false });

    return Promise.resolve({ status: "created", firstName: account.firstName });
  }
}
