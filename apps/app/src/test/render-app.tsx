import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { type Mock, vi } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../lib/query-client";
import { createAppRouter, redirectToSignIn, type RouteFactory } from "../router";

export interface RenderAppOptions {
  extraRoutes?: { auth?: RouteFactory[]; app?: RouteFactory[] };
}

/** Renders the whole app (router and query client, wired like `main.tsx`) at a path. */
export function renderApp(path: string, { extraRoutes }: RenderAppOptions = {}) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    extraRoutes,
  });
  const queryClient = createQueryClient(() => redirectToSignIn(router));

  render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );

  return { router, queryClient };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const SESSION_USER = {
  id: "5f1b6c1e-2d3a-4e5f-8a9b-0c1d2e3f4a5b",
  firstName: "Ana",
  lastName: "Silva",
  email: "ana@example.test",
};

export function unauthenticatedResponse(): Response {
  return jsonResponse(401, {
    error: { code: "UNAUTHENTICATED", message: "Authentication required.", details: [] },
  });
}

/** Replaces `fetch` with a mock that answers `GET /auth/session` with the given responses. */
export function stubSessionFetch(
  ...responses: Array<() => Response | Promise<Response>>
): Mock<typeof fetch> {
  const fetchMock: Mock<typeof fetch> = vi.fn();

  for (const response of responses) {
    fetchMock.mockImplementationOnce(() => Promise.resolve(response()));
  }

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}
