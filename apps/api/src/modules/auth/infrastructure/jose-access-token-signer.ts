import { jwtVerify, SignJWT } from "jose";
import type { AccessTokenClaims, AccessTokenSigner } from "../domain/session-ports";
import { MIN_JWT_SECRET_LENGTH } from "../../../config/auth-secret";
import { isUuid } from "../domain/session-rules";

const ALGORITHM = "HS256";

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** HS256 access tokens with a single shared secret (`AUTH_JWT_SECRET`). */
export class JoseAccessTokenSigner implements AccessTokenSigner {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      // The value itself is never part of the message.
      throw new Error(`AUTH_JWT_SECRET must have at least ${MIN_JWT_SECRET_LENGTH} characters.`);
    }

    this.key = new TextEncoder().encode(secret);
  }

  sign(claims: AccessTokenClaims, issuedAt: Date, expiresAt: Date): Promise<string> {
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
      .setSubject(claims.sub)
      .setIssuedAt(toSeconds(issuedAt))
      .setExpirationTime(toSeconds(expiresAt))
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        requiredClaims: ["sub", "sid", "iat", "exp"],
      });

      // `sid` and `sub` go straight into a database query: only UUIDs get through.
      if (isUuid(payload.sub) && isUuid(payload.sid)) {
        return { sub: payload.sub, sid: payload.sid };
      }
    } catch {
      // Malformed, bad signature, wrong algorithm, expired, missing claims: all the same "no".
    }

    return null;
  }
}
