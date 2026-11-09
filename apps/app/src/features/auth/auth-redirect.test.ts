import { describe, expect, it } from "vitest";
import { getAuthPageRedirect } from "./auth-redirect";

describe("getAuthPageRedirect", () => {
  it.each(["/auth/sign-in", "/auth/sign-up", "/auth/forgot-password"])(
    "sends a signed-in user from %s to /app",
    (path) => {
      expect(getAuthPageRedirect(path, true)).toBe("/app");
    },
  );

  it.each(["/auth/confirm-account", "/auth/reset-password"])(
    "keeps %s reachable while signed in",
    (path) => {
      expect(getAuthPageRedirect(path, true)).toBeNull();
    },
  );

  it.each(["/auth/confirm-account/", "/auth/reset-password//"])(
    "ignores trailing slashes on %s",
    (path) => {
      expect(getAuthPageRedirect(path, true)).toBeNull();
    },
  );

  it("sends a signed-in user away from any other auth path", () => {
    expect(getAuthPageRedirect("/auth/something-else", true)).toBe("/app");
    expect(getAuthPageRedirect("/auth", true)).toBe("/app");
  });

  it.each([
    "/auth/sign-in",
    "/auth/sign-up",
    "/auth/forgot-password",
    "/auth/confirm-account",
    "/auth/reset-password",
  ])("never redirects %s without a session", (path) => {
    expect(getAuthPageRedirect(path, false)).toBeNull();
  });
});
