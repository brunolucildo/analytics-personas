import { createMemoryHistory, createRoute } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createAppRouter, type RouteFactory } from "./router";

function renderAt(path: string, extraRoutes?: { auth?: RouteFactory[]; app?: RouteFactory[] }) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    extraRoutes,
  });

  render(<App router={router} />);

  return router;
}

function probe(path: string, testId: string): RouteFactory {
  return (parent) =>
    createRoute({
      getParentRoute: () => parent,
      path,
      component: () => <p data-testid={testId}>probe</p>,
    });
}

describe("app routing", () => {
  it("redirects / to /app and shows the home placeholder", async () => {
    const router = renderAt("/");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Hello World");
    expect(router.state.location.pathname).toBe("/app");
  });

  it("renders the home placeholder inside the app layout", async () => {
    renderAt("/app");

    const layout = await screen.findByTestId("app-layout");

    expect(within(layout).getByRole("heading", { level: 1 })).toHaveTextContent("Hello World");
  });

  it.each(["/does-not-exist", "/auth/does-not-exist", "/app/does-not-exist"])(
    "shows a single 'Page not found' heading with a link home for %s",
    async (path) => {
      renderAt(path);

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute(
        "href",
        "/",
      );
    },
  );

  it("renders a route registered under /auth inside the auth layout", async () => {
    renderAt("/auth/probe", { auth: [probe("probe", "auth-probe")] });

    const layout = await screen.findByTestId("auth-layout");

    expect(within(layout).getByTestId("auth-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("app-layout")).not.toBeInTheDocument();
  });

  it("renders a route registered under /app inside the app layout", async () => {
    renderAt("/app/probe", { app: [probe("probe", "app-probe")] });

    const layout = await screen.findByTestId("app-layout");

    expect(within(layout).getByTestId("app-probe")).toBeInTheDocument();
    expect(screen.queryByTestId("auth-layout")).not.toBeInTheDocument();
  });
});
