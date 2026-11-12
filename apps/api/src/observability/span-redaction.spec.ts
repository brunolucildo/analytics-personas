import type { Span } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { outgoingUrlAttributes, redactHttpRequestSpan, withoutQuery } from "./span-redaction";

describe("withoutQuery", () => {
  it("keeps the origin and the path and drops the query string and the fragment", () => {
    expect(withoutQuery("https://project.example.test/rest/v1/users?email=eq.a%40b.com#x")).toBe(
      "https://project.example.test/rest/v1/users",
    );
    expect(withoutQuery("http://127.0.0.1:54321/rest/v1/rpc/auth_sign_up")).toBe(
      "http://127.0.0.1:54321/rest/v1/rpc/auth_sign_up",
    );
  });

  it("returns an empty string for something that is not a URL", () => {
    expect(withoutQuery("not a url")).toBe("");
  });
});

describe("outgoingUrlAttributes", () => {
  it("overrides url.full without the filter and empties url.query", () => {
    const attributes = outgoingUrlAttributes({
      origin: "https://project.example.test",
      path: "/rest/v1/users?select=id&email=eq.someone%40example.com",
    });

    expect(attributes).toEqual({
      "url.full": "https://project.example.test/rest/v1/users",
      "url.query": "",
    });
    expect(JSON.stringify(attributes)).not.toContain("example.com");
  });

  it("still clears the query when the URL cannot be rebuilt", () => {
    expect(outgoingUrlAttributes({ origin: "", path: "?email=eq.a@b.com" })).toEqual({
      "url.full": "",
      "url.query": "",
    });
  });
});

describe("redactHttpRequestSpan", () => {
  it("empties the query string and the client address of an incoming request span", () => {
    const setAttribute = vi.fn();

    redactHttpRequestSpan({ setAttribute } as unknown as Span);

    expect(setAttribute).toHaveBeenCalledWith("url.query", "");
    expect(setAttribute).toHaveBeenCalledWith("client.address", "");
  });
});
