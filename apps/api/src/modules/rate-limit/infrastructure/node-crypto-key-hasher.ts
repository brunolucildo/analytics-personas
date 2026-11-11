import { createHash } from "node:crypto";
import type { KeyHasher } from "../domain/rate-limit-ports";

/** `KeyHasher` backed by Node's SHA-256. The digest is hex and always 64 chars. */
export class NodeCryptoKeyHasher implements KeyHasher {
  hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
