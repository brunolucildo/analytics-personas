import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { Argon2PasswordVerifier } from "./argon2-password-verifier";
import type { HashRunner } from "./hash-limiter";

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

  it("runs every call to the library under the hash budget, the phantom hash included", async () => {
    const run = vi.fn((task: () => Promise<unknown>) => task());
    const metered = new Argon2PasswordVerifier({ run } as HashRunner);
    const hash = await argon2.hash("known password", { type: argon2.argon2id });

    await metered.verify("known password", hash);
    expect(run).toHaveBeenCalledTimes(1);

    run.mockClear();
    await metered.verify("whatever", null);
    // The phantom hash (first unknown account) and its verification.
    expect(run).toHaveBeenCalledTimes(2);

    run.mockClear();
    await metered.verify("whatever", null);
    // The phantom hash is reused: only the verification is paid.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets a refusal reach the caller instead of answering 'wrong password'", async () => {
    const refusal = new Error("queue full");
    const refusing = new Argon2PasswordVerifier({
      run: () => Promise.reject(refusal),
    } as HashRunner);
    const hash = await argon2.hash("known password", { type: argon2.argon2id });

    await expect(refusing.verify("known password", hash)).rejects.toBe(refusal);
    await expect(refusing.verify("anything", null)).rejects.toBe(refusal);
  });

  it("does not remember a refused phantom hash: the next unknown account tries again", async () => {
    let refuse = true;
    const run = vi.fn((task: () => Promise<unknown>) =>
      refuse ? Promise.reject(new Error("queue full")) : task(),
    );
    const flaky = new Argon2PasswordVerifier({ run } as HashRunner);

    await expect(flaky.verify("x", null)).rejects.toThrowError("queue full");

    refuse = false;

    await expect(flaky.verify("x", null)).resolves.toBe(false);
  });
});
