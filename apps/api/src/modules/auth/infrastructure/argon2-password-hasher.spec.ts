import argon2 from "argon2";
import { describe, expect, it, vi } from "vitest";
import { Argon2PasswordHasher } from "./argon2-password-hasher";
import type { HashRunner } from "./hash-limiter";

describe("Argon2PasswordHasher", () => {
  const hasher = new Argon2PasswordHasher();

  it("produces an Argon2id hash that verifies against the password", async () => {
    const hash = await hasher.hash("correct horse battery");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("correct horse battery");
    await expect(argon2.verify(hash, "correct horse battery")).resolves.toBe(true);
    await expect(argon2.verify(hash, "wrong password")).resolves.toBe(false);
  });

  it("uses a different salt for the same password", async () => {
    const [first, second] = await Promise.all([
      hasher.hash("same password"),
      hasher.hash("same password"),
    ]);

    expect(first).not.toBe(second);
  });

  it("runs every hash under the hash budget and lets a refusal reach the caller", async () => {
    const run = vi.fn((task: () => Promise<unknown>) => task());
    const runner = { run } as HashRunner;

    const hash = await new Argon2PasswordHasher(runner).hash("through the budget");

    expect(run).toHaveBeenCalledTimes(1);
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const refusal = new Error("queue full");
    const refusing: HashRunner = { run: () => Promise.reject(refusal) };

    await expect(new Argon2PasswordHasher(refusing).hash("x")).rejects.toBe(refusal);
  });
});
