import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { ACCESS_TOKEN_KEY } from "../../lib/access-token";
import { createQueryClient } from "../../lib/query-client";
import { createAppRouter, redirectToSignIn } from "../../router";
import { jsonResponse, SESSION_USER } from "../../test/render-app";

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;
const ACCESS_TOKEN = "header.payload.signature";
const INVALID_HEADING = "This link is invalid or has expired";

function apiError(status: number, code: string) {
  return jsonResponse(status, { error: { code, message: "Server message.", details: [] } });
}

const confirmed = () =>
  jsonResponse(200, {
    accessToken: ACCESS_TOKEN,
    expiresAt: "2026-11-16T12:00:00.000Z",
    user: SESSION_USER,
  });

/** Answers the confirm call with `confirmResponse` and `GET /auth/session` with the user. */
function stubApi(confirmResponse: () => Response | Promise<Response>) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/auth/confirm-account")
        ? confirmResponse()
        : jsonResponse(200, { user: SESSION_USER }),
    ),
  );
}

function confirmCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/confirm-account"));
}

function renderPage(path: string, { strict = false }: { strict?: boolean } = {}) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const queryClient = createQueryClient(() => redirectToSignIn(router));
  const tree = (
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>
  );

  render(strict ? <StrictMode>{tree}</StrictMode> : tree);

  return router;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
});

describe("confirm account page", () => {
  it("shows the loading status while the request runs and never flashes the error", async () => {
    let finish: (response: Response) => void = () => undefined;

    stubApi(() => new Promise<Response>((resolve) => (finish = resolve)) as never);
    renderPage("/auth/confirm-account?token=abc");

    expect(await screen.findByRole("status")).toHaveTextContent("Confirming your account…");
    expect(screen.queryByRole("heading", { name: INVALID_HEADING })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    finish(confirmed());
  });

  it("posts the token once, stores the session token and lands on /app with the user's name", async () => {
    stubApi(confirmed);

    const router = renderPage("/auth/confirm-account?token=abc-123_XYZ");

    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome, Ana" })).toBeVisible();
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(ACCESS_TOKEN);

    const calls = confirmCalls();

    expect(calls).toHaveLength(1);

    const [url, init] = calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/api\/v1\/auth\/confirm-account$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ token: "abc-123_XYZ" });
  });

  it("calls the API a single time under React StrictMode and still finishes the flow", async () => {
    stubApi(confirmed);

    const router = renderPage("/auth/confirm-account?token=abc", { strict: true });

    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome, Ana" })).toBeVisible();
    expect(confirmCalls()).toHaveLength(1);
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(ACCESS_TOKEN);
  });

  it("does not use the link with a GET: the only request to the confirm endpoint is a POST", async () => {
    stubApi(confirmed);
    renderPage("/auth/confirm-account?token=abc");

    await screen.findByRole("heading", { level: 1, name: "Welcome, Ana" });

    expect(confirmCalls().map(([, init]) => (init as RequestInit).method)).toEqual(["POST"]);
  });

  it("shows the invalid-link state, with the way out, when the API refuses the token", async () => {
    stubApi(() => apiError(400, "TOKEN_INVALID_OR_EXPIRED"));
    renderPage("/auth/confirm-account?token=used");

    expect(await screen.findByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Request a new confirmation email" })).toHaveAttribute(
      "href",
      "/auth/resend-confirmation",
    );
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it.each([
    ["without the token parameter", "/auth/confirm-account"],
    ["with an empty token", "/auth/confirm-account?token="],
  ])("shows the invalid-link state %s and makes no call", async (_label, path) => {
    stubApi(confirmed);
    renderPage(path);

    expect(await screen.findByRole("heading", { level: 1, name: INVALID_HEADING })).toBeVisible();
    expect(screen.getByRole("link", { name: "Request a new confirmation email" })).toBeVisible();
    expect(confirmCalls()).toHaveLength(0);
  });

  it("shows the too-many-attempts message on 429", async () => {
    stubApi(() => apiError(429, "RATE_LIMITED"));
    renderPage("/auth/confirm-account?token=abc");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a few minutes.",
    );
    expect(screen.queryByRole("heading", { name: INVALID_HEADING })).not.toBeInTheDocument();
  });

  it("offers Try again after a network failure and succeeds on the second try", async () => {
    let attempts = 0;

    fetchMock.mockImplementation((url: string) => {
      if (!url.endsWith("/auth/confirm-account")) {
        return Promise.resolve(jsonResponse(200, { user: SESSION_USER }));
      }

      attempts += 1;

      return attempts === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(confirmed());
    });

    const router = renderPage("/auth/confirm-account?token=abc");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(attempts).toBe(2);
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(ACCESS_TOKEN);
  });

  it("offers Try again on a 5xx instead of the invalid-link state", async () => {
    stubApi(() => apiError(500, "INTERNAL_ERROR"));
    renderPage("/auth/confirm-account?token=abc");

    expect(await screen.findByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: INVALID_HEADING })).not.toBeInTheDocument();
  });

  it("stays reachable for a signed-in user and replaces the old token with the new one", async () => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, "old.session.token");
    stubApi(confirmed);

    const router = renderPage("/auth/confirm-account?token=abc");

    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(ACCESS_TOKEN);
    expect(confirmCalls()).toHaveLength(1);
  });
});
