import type {
  CredentialsRepository,
  NewSessionEmail,
  NewSessionMailer,
  PasswordVerifier,
  StoredCredentials,
} from "../../src/modules/auth/domain/sign-in-ports";

export interface StoredAccount extends StoredCredentials {
  email: string;
}

/** In-memory `CredentialsRepository` for unit tests: same contract as the Postgres one. */
export class InMemoryCredentialsRepository implements CredentialsRepository {
  constructor(private readonly accounts: StoredAccount[]) {}

  findByEmail(email: string): Promise<StoredCredentials | null> {
    const account = this.accounts.find((candidate) => candidate.email === email);

    return Promise.resolve(account ?? null);
  }
}

/** Treats `hashed:<password>` as the hash of `<password>` (see `FakePasswordHasher`). Records the calls. */
export class FakePasswordVerifier implements PasswordVerifier {
  readonly calls: Array<{ plain: string; hash: string | null }> = [];

  verify(plain: string, hash: string | null): Promise<boolean> {
    this.calls.push({ plain, hash });

    return Promise.resolve(hash !== null && hash === `hashed:${plain}`);
  }
}

export class RecordingNewSessionMailer implements NewSessionMailer {
  readonly sent: NewSessionEmail[] = [];

  sendNewSession(email: NewSessionEmail): Promise<void> {
    this.sent.push(email);

    return Promise.resolve();
  }
}
