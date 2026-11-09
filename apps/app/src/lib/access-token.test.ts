import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_KEY, clearAccessToken, getAccessToken, setAccessToken } from "./access-token";

describe("access token storage", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearAccessToken();
  });

  it("uses the access_token key of localStorage", () => {
    expect(ACCESS_TOKEN_KEY).toBe("access_token");

    setAccessToken("abc.def.ghi");

    expect(window.localStorage.getItem("access_token")).toBe("abc.def.ghi");
    expect(getAccessToken()).toBe("abc.def.ghi");
  });

  it("returns null when nothing is stored, or when the stored value is empty", () => {
    expect(getAccessToken()).toBeNull();

    window.localStorage.setItem(ACCESS_TOKEN_KEY, "");

    expect(getAccessToken()).toBeNull();
  });

  it("reads a token written by another tab", () => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, "from-another-tab");

    expect(getAccessToken()).toBe("from-another-tab");
  });

  it("removes the token", () => {
    setAccessToken("abc");
    clearAccessToken();

    expect(getAccessToken()).toBeNull();
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  describe("when localStorage throws (private mode, blocked site data)", () => {
    beforeEach(() => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    });

    it("never throws and has no token at first", () => {
      expect(() => getAccessToken()).not.toThrow();
      expect(getAccessToken()).toBeNull();
    });

    it("keeps the token in memory for the life of the page", () => {
      expect(() => setAccessToken("in-memory")).not.toThrow();
      expect(getAccessToken()).toBe("in-memory");
    });

    it("clears the in-memory token without throwing", () => {
      setAccessToken("in-memory");

      expect(() => clearAccessToken()).not.toThrow();
      expect(getAccessToken()).toBeNull();
    });
  });
});
