import argon2 from "argon2";
import type { PasswordHasher } from "../domain/auth-ports";

/** Argon2id with the library defaults (64 MiB, 3 passes, 4 lanes). The salt is random per hash. */
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }
}
