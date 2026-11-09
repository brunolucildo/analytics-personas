import { createRoute } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_KEY } from "./lib/access-token";
import type { RouteFactory } from "./router";
import { jsonResponse, renderApp, SESSION_USER, stubSessionFetch } from "./test/render-app";

const originalFetch = globalThis.fetch;

function probe(path: string, testId: string): RouteFactory {
  return (parent) =>
    createRoute({
      getParentRoute: () => parent,
      path,
      component: () => <p data-testid={testId}>probe</p>,
    });
}

/** A signed-in user: a token in localStorage and an API that accepts it. */
function signIn() {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, "header.payload.signature");
  stubSessionFetch(() => jsonResponse(200, { user: SESSION_USER }));
}

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("app routing", () => {
  describe("signed in", () => {
    beforeEach(signIn);

    it("redirects / to /app and shows the home", async () => {
      const { router } = renderApp("/");

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Ana");
      expect(router.state.location.pathname).toBe("/app");
    });

    it("renders the home inside the app layout", async () => {
      renderApp("/app");

      const layout = await screen.findByTestId("app-layout");

      expect(await within(layout).findByRole("heading", { level: 1 })).toHaveTextContent(
        "Welcome, Ana",
      );
    });

    it("renders a route registered under /app inside the app layout", async () => {
      renderApp("/app/probe", { extraRoutes: { app: [probe("probe", "app-probe")] } });

      const layout = await screen.findByTestId("app-layout");

      expect(await within(layout).findByTestId("app-probe")).toBeInTheDocument();
      expect(screen.queryByTestId("auth-layout")).not.toBeInTheDocument();
    });

    it("shows a single 'Page not found' heading with a link home for /app/does-not-exist", async () => {
      renderApp("/app/does-not-exist");

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
        "href",
        "/",
      );
    });
  });

  describe("signed out", () => {
    it.each(["/does-not-exist", "/auth/does-not-exist"])(
      "shows a single 'Page not found' heading with a link home for %s",
      async (path) => {
        renderApp(path);

        expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
          "Page not found",
        );
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
          "href",
          "/",
        );
      },
    );

    it("renders a route registered under /auth inside the auth layout", async () => {
      renderApp("/auth/probe", { extraRoutes: { auth: [probe("probe", "auth-probe")] } });

      const layout = await screen.findByTestId("auth-layout");

      expect(within(layout).getByTestId("auth-probe")).toBeInTheDocument();
      expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
    });

    it("keeps private routes closed: a probe under /app is never rendered", async () => {
      const { router } = renderApp("/app/probe", {
        extraRoutes: { app: [probe("probe", "app-probe")] },
      });

      await waitFor(() => expect(router.state.location.pathname).toBe("/auth/sign-in"));
      expect(screen.queryByTestId("app-probe")).not.toBeInTheDocument();
    });
  });
});
