import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import { Argon2PasswordVerifier } from "./argon2-password-verifier";

describe("Argon2PasswordVerifier", () => {
  const verifier = new Argon2PasswordVerifier();

  it("accepts the right password and refuses a wrong one", async () => {
    const hash = await argon2.hash("correct horse battery", { type: argon2.argon2id });

    await expect(verifier.verify("correct horse battery", hash)).resolves.toBe(true);
    await expect(verifier.verify("wrong password", hash)).resolves.toBe(false);
  });

  it("refuses a malformed stored hash instead of throwing", async () => {
    await expect(verifier.verify("anything", "not-a-hash")).resolves.toBe(false);
  });

  it("answers false for an unknown account after doing a real verification", async () => {
    const real = await argon2.hash("some password", { type: argon2.argon2id });
    const startedReal = performance.now();

    await verifier.verify("other password", real);

    const realMs = performance.now() - startedReal;

    // The first call also creates the phantom hash: warm it up, then measure.
    await verifier.verify("warm up", null);

    const startedUnknown = performance.now();

    await expect(verifier.verify("other password", null)).resolves.toBe(false);

    const unknownMs = performance.now() - startedUnknown;

    // Comparable cost: same order of magnitude (generous bounds, to stay stable on busy machines).
    expect(unknownMs).toBeGreaterThan(realMs / 5);
    expect(unknownMs).toBeLessThan(realMs * 5 + 200);
  });
});
