import { createHash, randomBytes } from "node:crypto";
import type { IssuedToken, TokenGenerator } from "../domain/auth-ports";

const TOKEN_BYTES = 32;

/** SHA-256 (hex) of a link token: the only form that is stored or compared. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Opaque, random, single-use tokens (256 bits, URL safe). */
export class CryptoTokenGenerator implements TokenGenerator {
  generate(): IssuedToken {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");

    return { token, tokenHash: hashToken(token) };
  }
}
