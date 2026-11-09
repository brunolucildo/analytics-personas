import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client", () => {
  it("posts JSON to the versioned base URL and returns the parsed body", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(201, { email: "ana@example.test" }));
    const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetcher });

    const result = await client.post<{ email: string }>("/auth/sign-up", {
      email: "ana@example.test",
    });

    expect(result).toEqual({ email: "ana@example.test" });
    expect(fetcher).toHaveBeenCalledWith("http://api.test/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: "ana@example.test" }),
    });
  });

  it("turns the error envelope into a typed ApiError", async () => {
    const details = [{ field: "email", message: "Enter a valid email address." }];
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, {
          error: { code: "VALIDATION_FAILED", message: "The request is invalid.", details },
        }),
      );
    const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetcher });

    const failure = await client.post("/x", {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      message: "The request is invalid.",
      details,
    });
  });

  it("reports a network failure as ApiError with status 0 and NETWORK_ERROR", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetcher });

    const failure = await client.post("/x", {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 0, code: "NETWORK_ERROR", details: [] });
  });

  it("falls back to UNKNOWN_ERROR when an error response is not the envelope", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const client = createApiClient({ baseUrl: "http://api.test/api/v1", fetch: fetcher });

    const failure = await client.post("/x", {}).catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 502, code: "UNKNOWN_ERROR", details: [] });
  });

  it("does not double the slash between the base URL and the path", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createApiClient({ baseUrl: "http://api.test/api/v1/", fetch: fetcher });

    await client.post("/auth/sign-up", {});

    expect(fetcher.mock.calls[0]?.[0]).toBe("http://api.test/api/v1/auth/sign-up");
  });
});
