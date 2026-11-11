import { beforeEach, describe, expect, it } from "vitest";
import type { CapturedEmail, CapturedEmailRepository } from "../../domain/captured-emails-ports";
import { ClearCapturedEmails } from "./clear-captured-emails.use-case";

const MESSAGE: CapturedEmail = {
  to: "pat@example.test",
  subject: "Welcome",
  text: "Hello",
  html: "<p>Hello</p>",
  from: { address: "no-reply@rondo.local" },
  capturedAt: "2026-11-11T12:00:00.000Z",
};

/** Minimal adapter of the port: keeps the messages and clears them on demand. */
class FakeCapturedEmailRepository implements CapturedEmailRepository {
  emails: CapturedEmail[] = [{ ...MESSAGE }];

  list(filter: { to?: string } = {}): CapturedEmail[] {
    return this.emails
      .filter((email) => filter.to === undefined || email.to === filter.to)
      .map((email) => ({ ...email }));
  }

  clear(): void {
    this.emails = [];
  }
}

describe("ClearCapturedEmails", () => {
  let repository: FakeCapturedEmailRepository;
  let useCase: ClearCapturedEmails;

  beforeEach(() => {
    repository = new FakeCapturedEmailRepository();
    useCase = new ClearCapturedEmails(repository);
  });

  it("empties the mailbox", () => {
    useCase.execute();

    expect(repository.emails).toEqual([]);
  });
});
