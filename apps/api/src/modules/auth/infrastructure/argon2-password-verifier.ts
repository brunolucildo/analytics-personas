import argon2 from "argon2";
import type { PasswordVerifier } from "../domain/sign-in-ports";
import { type HashRunner, UNLIMITED_HASH_RUNNER } from "./hash-limiter";

/**
 * Argon2id verification. For an unknown account (`hash` null) it checks the password
 * against a throw-away hash made with the same parameters as real ones, so the cost is
 * comparable and the answer is always `false`. Every call to the library runs under the
 * shared hash budget (`HashLimiter`); when the budget refuses (queue full) the refusal
 * reaches the caller as it is, never as a "wrong password".
 */
export class Argon2PasswordVerifier implements PasswordVerifier {
  /** Created on first use and reused: the cost is paid once, not on every unknown e-mail. */
  private phantomHash: Promise<string> | undefined;

  constructor(private readonly runner: HashRunner = UNLIMITED_HASH_RUNNER) {}

  async verify(plain: string, hash: string | null): Promise<boolean> {
    if (hash === null) {
      await this.check(await this.phantom(), plain);

      return false;
    }

    return this.check(hash, plain);
  }

  private phantom(): Promise<string> {
    this.phantomHash ??= this.runner
      .run(() => argon2.hash("phantom-password-never-matches", { type: argon2.argon2id }))
      .catch((error: unknown) => {
        // A refusal must not be cached: the next unknown e-mail tries again.
        this.phantomHash = undefined;

        throw error;
      });

    return this.phantomHash;
  }

  /** A malformed stored hash is never a match (and must not become a 500 for the caller). */
  private check(hash: string, plain: string): Promise<boolean> {
    return this.runner.run(() => argon2.verify(hash, plain).catch(() => false));
  }
}
