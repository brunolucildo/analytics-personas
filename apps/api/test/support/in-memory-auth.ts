import type {
  ConfirmationEmail,
  ConfirmationMailer,
  ConfirmationToken,
  CreateUserResult,
  IssuedToken,
  NewUser,
  PasswordHasher,
  TokenGenerator,
  UserRepository,
} from "../../src/modules/auth/domain/auth-ports";

export interface StoredUser extends NewUser {
  id: string;
  emailConfirmedAt: Date | null;
}

export interface StoredToken extends ConfirmationToken {
  userId: string;
}

/** In-memory `UserRepository` for unit tests: same contract as the Postgres one. */
export class InMemoryUserRepository implements UserRepository {
  readonly users: StoredUser[] = [];
  readonly tokens: StoredToken[] = [];

  createWithConfirmationToken(user: NewUser, token: ConfirmationToken): Promise<CreateUserResult> {
    if (this.users.some((stored) => stored.email === user.email)) {
      return Promise.resolve({ status: "email_taken" });
    }

    const id = `user-${this.users.length + 1}`;

    this.users.push({ ...user, id, emailConfirmedAt: null });
    this.tokens.push({ ...token, userId: id });

    return Promise.resolve({ status: "created", userId: id });
  }
}

export class FakePasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return Promise.resolve(`hashed:${plain}`);
  }
}

export class FakeTokenGenerator implements TokenGenerator {
  private counter = 0;

  generate(): IssuedToken {
    this.counter += 1;

    return { token: `token-${this.counter}`, tokenHash: `hash-${this.counter}` };
  }
}

export class RecordingConfirmationMailer implements ConfirmationMailer {
  readonly sent: ConfirmationEmail[] = [];

  sendConfirmation(email: ConfirmationEmail): Promise<void> {
    this.sent.push(email);

    return Promise.resolve();
  }
}
