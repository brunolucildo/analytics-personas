import { EventEmitter } from "node:events";
import { INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";
import { type RPCMetadata, RPCType } from "@opentelemetry/core";
import { describe, expect, it, vi } from "vitest";
import { createHttpRouteMiddleware, routeOf, UNMATCHED_ROUTE } from "./http-route";

function httpMetadata(): RPCMetadata {
  return { type: RPCType.HTTP, span: trace.wrapSpanContext(INVALID_SPAN_CONTEXT) };
}

describe("routeOf", () => {
  it("uses the matched route template, never the raw path", () => {
    expect(routeOf({ baseUrl: "", route: { path: "/api/v1/auth/sign-in" } })).toBe(
      "/api/v1/auth/sign-in",
    );
    expect(routeOf({ baseUrl: "/api/v1", route: { path: "/users/:id" } })).toBe(
      "/api/v1/users/:id",
    );
  });

  it("falls back to the fixed unmatched value when no route matched", () => {
    expect(routeOf({})).toBe(UNMATCHED_ROUTE);
    expect(routeOf({ baseUrl: "/api/v1" })).toBe(UNMATCHED_ROUTE);
  });

  it("treats a wildcard catch-all route (unknown path under the prefix) as unmatched", () => {
    expect(routeOf({ baseUrl: "", route: { path: "/api/v1*path" } })).toBe(UNMATCHED_ROUTE);
    expect(routeOf({ route: { path: "/*" } })).toBe(UNMATCHED_ROUTE);
  });

  it("ignores routes that are not a plain string path", () => {
    expect(routeOf({ route: { path: /^\/secret\/.*$/ } })).toBe(UNMATCHED_ROUTE);
    expect(routeOf({ route: { path: ["/a", "/b"] } })).toBe(UNMATCHED_ROUTE);
  });
});

describe("createHttpRouteMiddleware", () => {
  it("writes the route into the HTTP metadata once the response finished", () => {
    const metadata = httpMetadata();
    const middleware = createHttpRouteMiddleware(() => metadata);
    const request = { baseUrl: "", route: { path: "/api/v1/auth/sign-in" } };
    const response = new EventEmitter();
    const next = vi.fn();

    middleware(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(metadata.type === RPCType.HTTP && metadata.route).toBeUndefined();

    response.emit("finish");

    expect(metadata.type === RPCType.HTTP && metadata.route).toBe("/api/v1/auth/sign-in");
  });

  it("marks a request that matched no route as unmatched", () => {
    const metadata = httpMetadata();
    const middleware = createHttpRouteMiddleware(() => metadata);
    const response = new EventEmitter();

    middleware({}, response, vi.fn());
    response.emit("finish");

    expect(metadata.type === RPCType.HTTP && metadata.route).toBe(UNMATCHED_ROUTE);
  });

  it("does nothing, and never throws, without HTTP metadata (SDK disabled)", () => {
    const middleware = createHttpRouteMiddleware(() => undefined);
    const response = new EventEmitter();
    const next = vi.fn();

    middleware({ route: { path: "/x" } }, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(() => response.emit("finish")).not.toThrow();
  });
});
