import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import { Argon2PasswordHasher } from "./argon2-password-hasher";

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
});
