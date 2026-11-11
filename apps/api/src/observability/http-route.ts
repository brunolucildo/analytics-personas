import { context } from "@opentelemetry/api";
import { getRPCMetadata, type RPCMetadata, RPCType } from "@opentelemetry/core";

/** Fixed value for requests that matched no route (unknown path, other prefix, CORS preflight). */
export const UNMATCHED_ROUTE = "unmatched";

interface RoutedRequest {
  baseUrl?: string;
  route?: { path?: unknown };
}

interface FinishableResponse {
  once(event: "finish", listener: () => void): unknown;
}

/**
 * The route template Express matched (`/api/v1/auth/sign-in`, `/api/v1/users/:id`), or
 * `unmatched`. Never the raw path, so the label stays low-cardinality and carries no query
 * string, id or token. A wildcard route (Nest's catch-all for unknown paths under the prefix,
 * `/api/v1*path`) answers "nothing here", so it counts as unmatched too.
 */
export function routeOf(request: RoutedRequest): string {
  const path = request.route?.path;

  if (typeof path !== "string" || path.includes("*")) {
    return UNMATCHED_ROUTE;
  }

  return `${request.baseUrl ?? ""}${path}`;
}

const activeMetadata = (): RPCMetadata | undefined => getRPCMetadata(context.active());

/**
 * Gives `http_server_request_duration_seconds` its `http_route` label.
 *
 * `@opentelemetry/instrumentation-http` reads `route` from the request's RPC metadata when the
 * response closes, but the Express 5 instrumentation never fills it in. Here the route is written
 * on `finish` (the matched route is known by then, and `finish` comes before `close`).
 * Without the SDK there is no metadata and this is a no-op.
 */
export function createHttpRouteMiddleware(
  readMetadata: () => RPCMetadata | undefined = activeMetadata,
) {
  return (request: RoutedRequest, response: FinishableResponse, next: () => void): void => {
    // Read now: the request context is certainly the active one here.
    const metadata = readMetadata();

    if (metadata?.type === RPCType.HTTP) {
      response.once("finish", () => {
        metadata.route = routeOf(request);
      });
    }

    next();
  };
}
