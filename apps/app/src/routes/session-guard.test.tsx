import { createRoute } from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_KEY, setAccessToken } from "../lib/access-token";
import type { RouteFactory } from "../router";
import {
  jsonResponse,
  renderApp,
  SESSION_USER,
  stubSessionFetch,
  unauthenticatedResponse,
} from "../test/render-app";

const originalFetch = globalThis.fetch;
const TOKEN = "header.payload.signature";

const sessionOk = () => jsonResponse(200, { user: SESSION_USER });
const serverError = () =>
  jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "Boom.", details: [] } });

function probe(path: string, testId: string): RouteFactory {
  return (parent) =>
    createRoute({
      getParentRoute: () => parent,
      path,
      component: () => <p data-testid={testId}>probe</p>,
    });
}

const AUTH_PROBES = {
  auth: [probe("sign-in", "page-sign-in"), probe("reset-password", "page-reset-password")],
};

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

describe("/app is private (R7, R8, R10)", () => {
  it("sends a visitor without a token to /auth/sign-in without calling the API", async () => {
    const fetchMock = stubSessionFetch();
    const { router } = renderApp("/app");

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
  });

  it("sends / to /auth/sign-in too when there is no token", async () => {
    const { router } = renderApp("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
  });

  describe("with a token in localStorage", () => {
    beforeEach(() => {
      window.localStorage.setItem(ACCESS_TOKEN_KEY, TOKEN);
    });

    it("sends the bearer token, announces the check and then shows the home", async () => {
      let release: (response: Response) => void = () => undefined;
      const fetchMock = stubSessionFetch(
        () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response,
      );
      const { router } = renderApp("/app");

      const status = await screen.findByRole("status");

      expect(status).toHaveTextContent("Verifying your session");
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();

      release(sessionOk());

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByText("You are signed in.")).toBeInTheDocument();
      expect(screen.queryByText("Hello World")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/app");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toMatch(/\/api\/v1\/auth\/session$/);
      expect(init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    });

    it("redirects / to the home when the session is valid", async () => {
      stubSessionFetch(sessionOk);
      const { router } = renderApp("/");

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
      expect(router.state.location.pathname).toBe("/app");
    });

    it("removes an invalid token and goes to /auth/sign-in", async () => {
      stubSessionFetch(unauthenticatedResponse);
      const { router } = renderApp("/app");

      await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
      expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
      expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument();
    });

    it.each([
      ["a server error", serverError],
      ["a network failure", () => Promise.reject(new TypeError("Failed to fetch")) as never],
    ])("shows a retry screen on %s and keeps the token", async (_label, failure) => {
      stubSessionFetch(failure, sessionOk);
      const user = userEvent.setup();
      const { router } = renderApp("/app");

      expect(
        await screen.findByRole("heading", { level: 1, name: "We couldn't verify your session." }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/app");
      expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(TOKEN);

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
    });

    it("escapes the name it shows", async () => {
      stubSessionFetch(() =>
        jsonResponse(200, { user: { ...SESSION_USER, firstName: "<img src=x onerror=alert(1)>" } }),
      );
      renderApp("/app");

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome, <img src=x onerror=alert(1)>",
      );
      expect(document.querySelector("img")).toBeNull();
    });

    it("shows the not-found page for an unknown /app path of a signed-in user", async () => {
      stubSessionFetch(sessionOk);
      renderApp("/app/does-not-exist");

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
    });
  });

  it("does not break when localStorage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const fetchMock = stubSessionFetch();
    const { router } = renderApp("/app");

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a token held in memory working when localStorage refuses to store it", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    setAccessToken(TOKEN);
    stubSessionFetch(sessionOk);
    renderApp("/app");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
  });
});

describe("/auth/* for a signed-in user (R9)", () => {
  beforeEach(() => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, TOKEN);
  });

  it.each(["/auth/sign-up", "/auth/sign-in", "/auth/forgot-password"])(
    "sends %s to /app",
    async (path) => {
      stubSessionFetch(sessionOk, sessionOk);
      const { router } = renderApp(path, { extraRoutes: AUTH_PROBES });

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
      expect(router.state.location.pathname).toBe("/app");
    },
  );

  it("leaves /auth/reset-password reachable", async () => {
    stubSessionFetch(sessionOk);
    const { router } = renderApp("/auth/reset-password", { extraRoutes: AUTH_PROBES });

    expect(await screen.findByTestId("page-reset-password")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth/reset-password");
  });

  // The real page (spec 0006): with no token in the URL it shows the invalid-link state and
  // makes no call, so a signed-in user is neither redirected nor sent to the API.
  it("leaves /auth/confirm-account reachable", async () => {
    stubSessionFetch(sessionOk);
    const { router } = renderApp("/auth/confirm-account");

    expect(
      await screen.findByRole("heading", { level: 1, name: "This link is invalid or has expired" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth/confirm-account");
  });
});

describe("/auth/* with a token that does not give a session", () => {
  beforeEach(() => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, TOKEN);
  });

  it("shows the page and removes the token when the API answers 401", async () => {
    stubSessionFetch(unauthenticatedResponse);
    const { router } = renderApp("/auth/sign-up");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull());
    expect(router.state.location.pathname).toBe("/auth/sign-up");
  });

  it("shows the page and keeps the token when the check fails (network or server)", async () => {
    stubSessionFetch(serverError);
    const { router } = renderApp("/auth/sign-up");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(TOKEN);
    expect(router.state.location.pathname).toBe("/auth/sign-up");
  });
});

describe("/auth/* without a token", () => {
  it("shows the page at once and never calls the API", async () => {
    const fetchMock = stubSessionFetch();

    renderApp("/auth/sign-up");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
