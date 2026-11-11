import { beforeEach, describe, expect, it } from "vitest";
import type { CapturedEmail, CapturedEmailRepository } from "../../domain/captured-emails-ports";
import { ListCapturedEmails } from "./list-captured-emails.use-case";

const MESSAGE: CapturedEmail = {
  to: "pat@example.test",
  subject: "Welcome",
  text: "Hello",
  html: "<p>Hello</p>",
  from: { address: "no-reply@rondo.local" },
  capturedAt: "2026-11-11T12:00:00.000Z",
};

/** Minimal adapter of the port: records the filter and answers a defensive copy. */
class FakeCapturedEmailRepository implements CapturedEmailRepository {
  readonly filters: Array<{ to?: string } | undefined> = [];
  private readonly emails: CapturedEmail[];

  constructor(emails: CapturedEmail[]) {
    this.emails = emails;
  }

  list(filter?: { to?: string }): CapturedEmail[] {
    this.filters.push(filter);
    const to = filter?.to?.trim().toLowerCase();

    return this.emails
      .filter((email) => to === undefined || email.to.toLowerCase() === to)
      .map((email) => ({ ...email }));
  }

  clear(): void {
    this.emails.length = 0;
  }
}

describe("ListCapturedEmails", () => {
  let repository: FakeCapturedEmailRepository;
  let useCase: ListCapturedEmails;

  beforeEach(() => {
    repository = new FakeCapturedEmailRepository([
      { ...MESSAGE },
      { ...MESSAGE, to: "sam@example.test", subject: "Second" },
    ]);
    useCase = new ListCapturedEmails(repository);
  });

  it("forwards the recipient filter to the repository", () => {
    useCase.execute({ to: "Pat@Example.test" });

    expect(repository.filters).toEqual([{ to: "Pat@Example.test" }]);
  });

  it("returns the messages of the repository, filtered by the normalized recipient", () => {
    const emails = useCase.execute({ to: "  PAT@example.test  " });

    expect(emails.map((email) => email.subject)).toEqual(["Welcome"]);
  });

  it("returns every message when no recipient is given", () => {
    expect(useCase.execute().map((email) => email.to)).toEqual([
      "pat@example.test",
      "sam@example.test",
    ]);
  });

  it("does not expose the stored messages to mutation", () => {
    const [first] = useCase.execute({ to: "pat@example.test" });

    if (first !== undefined) {
      first.subject = "changed";
    }

    expect(useCase.execute({ to: "pat@example.test" })[0]?.subject).toBe("Welcome");
  });
});
