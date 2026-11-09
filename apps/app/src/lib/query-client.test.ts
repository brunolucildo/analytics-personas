import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { createQueryClient } from "./query-client";

const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Authentication required.");

describe("createQueryClient", () => {
  it("calls the handler when a query fails with 401 UNAUTHENTICATED", async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);

    await client
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => Promise.reject(unauthenticated()),
        retry: false,
      })
      .catch(() => undefined);

    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("calls the handler when a mutation fails with 401 UNAUTHENTICATED", async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(unauthenticated()) })
      .execute(undefined)
      .catch(() => undefined);

    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it.each([
    new ApiError(401, "INVALID_CREDENTIALS", "Wrong."),
    new ApiError(500, "INTERNAL_ERROR", "Boom."),
    new ApiError(0, "NETWORK_ERROR", "Offline."),
    new Error("plain"),
  ])("ignores %s", async (error) => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient(onUnauthenticated);

    await client
      .fetchQuery({ queryKey: ["y"], queryFn: () => Promise.reject(error), retry: false })
      .catch(() => undefined);

    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
