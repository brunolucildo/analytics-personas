import { createMemoryHistory } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createAppRouter } from "./router";

describe("App", () => {
  it("renders the route matched by the router it receives", async () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ["/auth/does-not-exist"] }),
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <App router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Page not found");
  });
});
