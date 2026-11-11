import type { Attributes, Span } from "@opentelemetry/api";

/**
 * The HTTP instrumentations record the full URL, query string included. For PostgREST the query
 * string is the filter (`?email=eq.someone%40example.com`, `?id=eq.<session id>`), and for the
 * incoming requests it is whatever the client sent. The spans keep the path and drop the rest.
 */

/** `https://host/path?x=1#y` -> `https://host/path`. Unparseable input yields an empty string. */
export function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

interface OutgoingRequest {
  origin: string;
  path: string;
}

/** `startSpanHook` of the undici instrumentation (outgoing `fetch`): overrides `url.full` and `url.query`. */
export function outgoingUrlAttributes(request: OutgoingRequest): Attributes {
  let full = "";

  try {
    full = withoutQuery(new URL(request.path, request.origin).href);
  } catch {
    // An unparseable URL gets no URL attribute at all.
  }

  return { "url.full": full, "url.query": "" };
}

/**
 * `requestHook` of the HTTP instrumentation: clears the query string and the client address (an IP
 * identifies a person) on the span of an incoming request. The path and the route are kept.
 */
export function redactHttpRequestSpan(span: Span): void {
  span.setAttribute("url.query", "");
  span.setAttribute("client.address", "");
}
