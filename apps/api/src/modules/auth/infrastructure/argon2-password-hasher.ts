import argon2 from "argon2";
import type { PasswordHasher } from "../domain/auth-ports";
import { type HashRunner, UNLIMITED_HASH_RUNNER } from "./hash-limiter";

/**
 * Argon2id with the library defaults (64 MiB, 3 passes, 4 lanes). The salt is random per hash.
 * Every hash runs under the shared hash budget (`HashLimiter`): see its comment for why.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly runner: HashRunner = UNLIMITED_HASH_RUNNER) {}

  hash(plain: string): Promise<string> {
    return this.runner.run(() => argon2.hash(plain, { type: argon2.argon2id }));
  }
}
