import { describe, expect, it, vi } from "vitest";
import { CaptureEmailProvider } from "./capture-email-provider";
import { CapturedEmailStore } from "./captured-email-store";

const from = { name: "Rondo", address: "no-reply@rondo.local" };

function message(to: string, subject = "Hello") {
  return { to, subject, text: "text", html: "<p>html</p>", purpose: "test" };
}

describe("CaptureEmailProvider", () => {
  it("stores the message with the sender and never touches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const store = new CapturedEmailStore();

    await new CaptureEmailProvider(from, store).deliver(message("pat@example.test"));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.list()).toMatchObject([
      { to: "pat@example.test", subject: "Hello", from, html: "<p>html</p>", text: "text" },
    ]);
    fetchSpy.mockRestore();
  });

  it("lists only the messages of one recipient, ignoring case", async () => {
    const store = new CapturedEmailStore();
    const provider = new CaptureEmailProvider(from, store);

    await provider.deliver(message("pat@example.test", "first"));
    await provider.deliver(message("sam@example.test", "second"));

    expect(store.list({ to: "PAT@example.test" }).map((email) => email.subject)).toEqual(["first"]);
    expect(store.list({ to: "nobody@example.test" })).toEqual([]);
  });

  it("clears the mailbox and keeps only the latest 500 messages", async () => {
    const store = new CapturedEmailStore();
    const provider = new CaptureEmailProvider(from, store);

    for (let index = 0; index < 505; index += 1) {
      await provider.deliver(message("pat@example.test", `n${index}`));
    }

    expect(store.list()).toHaveLength(500);
    expect(store.list()[0]?.subject).toBe("n5");

    store.clear();
    expect(store.list()).toEqual([]);
  });
});
