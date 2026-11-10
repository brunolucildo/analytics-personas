import { describe, expect, it } from "vitest";
import { CryptoTokenGenerator, hashToken } from "./crypto-token-generator";

describe("CryptoTokenGenerator", () => {
  const generator = new CryptoTokenGenerator();

  it("issues a URL-safe token with 256 bits of entropy", () => {
    const { token } = generator.generate();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("issues a different token every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generator.generate().token));

    expect(tokens.size).toBe(200);
  });

  it("returns the SHA-256 hex digest of the token as its hash", () => {
    const { token, tokenHash } = generator.generate();

    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toContain(token);
  });

  it("hashes to a known SHA-256 value", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
