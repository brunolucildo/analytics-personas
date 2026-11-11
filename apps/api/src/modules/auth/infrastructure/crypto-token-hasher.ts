import type { TokenHasher } from "../domain/auth-ports";
import { hashToken } from "./crypto-token-generator";

/** `TokenHasher` backed by the SHA-256 (hex) that `CryptoTokenGenerator` already stores. */
export class CryptoTokenHasher implements TokenHasher {
  hash(token: string): string {
    return hashToken(token);
  }
}
