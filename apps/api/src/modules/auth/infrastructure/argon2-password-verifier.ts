import argon2 from "argon2";
import type { PasswordVerifier } from "../domain/sign-in-ports";

/**
 * Argon2id verification. For an unknown account (`hash` null) it checks the password
 * against a throw-away hash made with the same parameters as real ones, so the cost is
 * comparable and the answer is always `false`.
 */
export class Argon2PasswordVerifier implements PasswordVerifier {
  /** Created on first use and reused: the cost is paid once, not on every unknown e-mail. */
  private phantomHash: Promise<string> | undefined;

  async verify(plain: string, hash: string | null): Promise<boolean> {
    if (hash === null) {
      this.phantomHash ??= argon2.hash("phantom-password-never-matches", {
        type: argon2.argon2id,
      });
      await argon2.verify(await this.phantomHash, plain).catch(() => false);

      return false;
    }

    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed stored hash is never a match (and must not become a 500 for the caller).
      return false;
    }
  }
}
