import { SpanKind, SpanStatusCode, metrics, trace } from "@opentelemetry/api";
import { DURATION_BUCKETS_SECONDS } from "./duration-buckets";
import { baseLogger } from "./logger";

/**
 * Telemetry for every call the API makes to Postgres. The data layer is `supabase-js`
 * (ADR 0008), so each query is an HTTP call to PostgREST: `GET|POST|PATCH|DELETE /rest/v1/<table>`
 * or `POST /rest/v1/rpc/<function>`. Wrapping the client's `fetch` instruments all of them in one
 * place, with no change to the repositories.
 *
 * What is recorded is derived from the *path* only: the operation, the table or the SQL function.
 * Never the query string, where PostgREST puts the filters (`email=eq.someone@example.com`,
 * `id=eq.<session id>`), nor the body, headers or response.
 */

const TRACER_NAME = "rondo-api";
const REST_PREFIX = "/rest/v1/";
const RPC_PREFIX = "rpc/";

/** Table and function names come from our own code; anything else collapses to `unknown`. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const UNKNOWN = "unknown";

export type DbOperation = "select" | "insert" | "update" | "delete" | "rpc" | "other";

export interface DbCall {
  operation: DbOperation;
  /** The table, for `select`, `insert`, `update` and `delete`. */
  collection?: string;
  /** The SQL function, for `rpc`. */
  procedure?: string;
}

function operationOf(method: string): DbOperation {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
      return "select";
    case "POST":
      return "insert";
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "other";
  }
}

const identifier = (value: string | undefined): string =>
  value !== undefined && SAFE_IDENTIFIER.test(value) ? value : UNKNOWN;

/** What a request to the data API does, or `undefined` when it is not a PostgREST call. */
export function describeDbCall(method: string, url: string): DbCall | undefined {
  let pathname: string;

  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }

  if (!pathname.startsWith(REST_PREFIX)) {
    return undefined;
  }

  const target = pathname.slice(REST_PREFIX.length);

  if (target.startsWith(RPC_PREFIX)) {
    return {
      operation: "rpc",
      procedure: identifier(target.slice(RPC_PREFIX.length).split("/")[0]),
    };
  }

  return { operation: operationOf(method), collection: identifier(target.split("/")[0]) };
}

function createInstruments() {
  return {
    duration: metrics.getMeter(TRACER_NAME).createHistogram("db.client.operation.duration", {
      description:
        "Time Postgres took to answer an operation, as seen by the API (to the response headers).",
      unit: "s",
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
    }),
  };
}

let instruments: ReturnType<typeof createInstruments> | undefined;

// Created on first use: the API meter provider is only registered when the SDK starts.
function getInstruments() {
  instruments ??= createInstruments();

  return instruments;
}

const spanNameOf = (call: DbCall) => `${call.operation} ${call.procedure ?? call.collection}`;

function attributesOf(call: DbCall): Record<string, string> {
  return {
    "db.system.name": "postgresql",
    "db.operation.name": call.operation,
    ...(call.collection === undefined ? {} : { "db.collection.name": call.collection }),
    ...(call.procedure === undefined ? {} : { "db.stored_procedure.name": call.procedure }),
  };
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  return input instanceof URL ? input.href : input.url;
}

function methodOf(input: Parameters<typeof fetch>[0], init?: RequestInit): string {
  return init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
}

/**
 * A `fetch` that records a span (`<operation> <table|function>`, a child of whatever is active,
 * usually `auth.<operation>`) and the histogram `db.client.operation.duration` for each PostgREST
 * call, and passes everything else through untouched.
 *
 * `error.type` is the HTTP status for any 4xx/5xx and `network` when the call itself failed. Only
 * a 5xx or a network failure marks the span as `ERROR`: a 4xx from PostgREST is usually business
 * flow (`406` for a `maybeSingle()` with no row, `409` for a unique violation). A 5xx or a
 * network failure also logs `event: "db_operation_failed"` (operation, table or function, error
 * type: nothing from the query), which gives an exact count that the counter alone would lose for
 * the first failure of a new series. Telemetry is best-effort and never changes the answer.
 */
export function createInstrumentedFetch(baseFetch?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const send = baseFetch ?? globalThis.fetch;
    const call = describeDbCall(methodOf(input, init), urlOf(input));

    if (call === undefined) {
      return send(input, init);
    }

    const attributes = attributesOf(call);

    return trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(spanNameOf(call), { kind: SpanKind.CLIENT, attributes }, async (span) => {
        const startedAt = performance.now();
        let errorType: string | undefined;
        let failed = false;

        try {
          const response = await send(input, init);

          span.setAttribute("db.response.status_code", String(response.status));

          if (response.status >= 400) {
            errorType = String(response.status);
            span.setAttribute("error.type", errorType);
          }

          if (response.status >= 500) {
            failed = true;
            span.setStatus({ code: SpanStatusCode.ERROR });
          }

          return response;
        } catch (error) {
          errorType = "network";
          failed = true;
          span.setAttribute("error.type", errorType);
          span.setStatus({ code: SpanStatusCode.ERROR });

          throw error;
        } finally {
          span.end();

          try {
            getInstruments().duration.record(
              (performance.now() - startedAt) / 1000,
              errorType === undefined ? attributes : { ...attributes, "error.type": errorType },
            );
            if (failed) {
              baseLogger.warn(
                {
                  event: "db_operation_failed",
                  operation: call.operation,
                  ...(call.collection === undefined ? {} : { collection: call.collection }),
                  ...(call.procedure === undefined ? {} : { procedure: call.procedure }),
                  errorType,
                },
                "db_operation_failed",
              );
            }
          } catch {
            // Telemetry must never take a request down.
          }
        }
      });
  };
}
