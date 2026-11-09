import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_KEY } from "../../lib/access-token";
import {
  jsonResponse,
  renderApp,
  SESSION_USER,
  stubSessionFetch,
  unauthenticatedResponse,
} from "../../test/render-app";

const originalFetch = globalThis.fetch;
const TOKEN = "header.payload.signature";

const sessionOk = () => jsonResponse(200, { user: SESSION_USER });
const noContent = () => new Response(null, { status: 204 });
const serverError = () =>
  jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "Boom.", details: [] } });
const networkFailure = () => Promise.reject(new TypeError("Failed to fetch")) as never;

async function openHome() {
  const result = renderApp("/app");

  await screen.findByRole("heading", { level: 1, name: "Welcome, Ana" });

  return result;
}

function signOutCall(fetchMock: ReturnType<typeof stubSessionFetch>) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/sign-out"));

  return call as [string, RequestInit] | undefined;
}

beforeEach(() => {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, TOKEN);
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
  vi.restoreAllMocks();
});

describe("the Sign out button on the home (R3)", () => {
  it("is a button named Sign out, enabled, with a touch area of at least 44x44 px", async () => {
    stubSessionFetch(sessionOk);
    await openHome();

    const button = screen.getByRole("button", { name: "Sign out" });

    expect(button).toBeEnabled();
    // `h-11` is 2.75rem (44 px at the default root size); jsdom has no layout to measure.
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/min-w-28/);
    expect(button.className).toMatch(/focus-visible:ring-2/);
  });

  it("calls the API with the bearer token, clears token and cache and goes to /auth/sign-in", async () => {
    const fetchMock = stubSessionFetch(sessionOk, noContent);
    const user = userEvent.setup();
    const { router, queryClient } = await openHome();

    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));

    const call = signOutCall(fetchMock);

    expect(call?.[1].method).toBe("POST");
    expect(call?.[1].headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    // The sign-in page (spec 0007) mounts `useSession` on a disabled query: no data is what matters.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.data !== undefined),
    ).toHaveLength(0);
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("works from the keyboard with %s", async (_label, key) => {
    const fetchMock = stubSessionFetch(sessionOk, noContent);
    const user = userEvent.setup();
    const { router } = await openHome();

    await user.tab();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();

    await user.keyboard(key);

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
    expect(signOutCall(fetchMock)).toBeDefined();
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it("is disabled and busy while the request runs, and sends it only once", async () => {
    let release: (response: Response) => void = () => undefined;
    const fetchMock = stubSessionFetch(
      sessionOk,
      () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response,
    );
    const user = userEvent.setup();
    const { router } = await openHome();
    const button = screen.getByRole("button", { name: "Sign out" });

    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");

    await user.click(button);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/sign-out")),
    ).toHaveLength(1);
    expect(router.state.location.pathname).toBe("/app");
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(TOKEN);

    release(noContent());

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
  });
});

describe("signing out when the API fails (R4)", () => {
  it.each([
    ["a network failure", networkFailure],
    ["a server error", serverError],
    ["a 401 (the session was already gone)", unauthenticatedResponse],
  ])("still drops the token and goes to /auth/sign-in on %s", async (_label, failure) => {
    stubSessionFetch(sessionOk, failure);
    const user = userEvent.setup();
    const { router, queryClient } = await openHome();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    // The sign-in page (spec 0007) mounts `useSession` on a disabled query: no data is what matters.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.data !== undefined),
    ).toHaveLength(0);
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps /app private afterwards: opening it again goes back to /auth/sign-in without the API", async () => {
    const fetchMock = stubSessionFetch(sessionOk, noContent);
    const user = userEvent.setup();
    const { router } = await openHome();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));

    const callsBefore = fetchMock.mock.calls.length;

    await router.navigate({ to: "/app" });

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
