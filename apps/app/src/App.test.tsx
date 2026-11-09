import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createAppRouter } from "./router";

describe("App", () => {
  it("renders the route matched by the router it receives", async () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ["/app"] }),
    });

    render(<App router={router} />);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Hello World");
  });
});
