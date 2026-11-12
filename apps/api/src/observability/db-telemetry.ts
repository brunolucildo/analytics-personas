import { SpanKind, SpanStatusCode, metrics, trace } from "@opentelemetry/api";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { isInfrastructureFailure, sqlStateOf } from "../common/sql-state";
import { DURATION_BUCKETS_SECONDS } from "./duration-buckets";
import { baseLogger } from "./logger";

/**
 * Telemetry for every call the API makes to Postgres through the `pg` Pool.
 *
 * The repositories declare what they are doing (`operation` plus the table or the
 * SQL function). The wrapper never inspects the SQL: the statement and the
 * parameters carry e-mail, hashes and session ids, so they are not read, recorded
 * or logged. A name that is not a plain SQL identifier collapses to `unknown`.
 *
 * `error.type` is the SQLSTATE (or `connection` when there is none). Only an
 * infrastructure failure (connection error or SQLSTATE classes 08, 53, 57 and 58)
 * marks the span as `ERROR` and logs `db_operation_failed`: a unique/check
 * violation (23*, 22*) is business flow and stays out of the error rate.
 */

const TRACER_NAME = "rondo-api";
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const UNKNOWN = "unknown";

const DB_OPERATIONS = new Set<DbOperation>(["select", "insert", "update", "delete", "rpc", "other"]);

export type DbOperation = "select" | "insert" | "update" | "delete" | "rpc" | "other";

export interface DbCall {
  operation: DbOperation;
  /** The table, for `select`, `insert`, `update` and `delete`. */
  collection?: string;
  /** The SQL function, for `rpc`. */
  procedure?: string;
}

/**
 * The API's database handle. Repositories depend on this narrow interface, not on
 * the Pool, so every query goes through the instrumentation and the tests can
 * replace it with a fake.
 */
export interface DatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    call: DbCall,
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
}

const identifier = (value: string | undefined): string =>
  value !== undefined && SAFE_IDENTIFIER.test(value) ? value : UNKNOWN;

const operationOf = (value: DbOperation): DbOperation =>
  DB_OPERATIONS.has(value) ? value : "other";

interface SafeTarget {
  collection?: string;
  procedure?: string;
}

function targetOf(call: DbCall): SafeTarget {
  if (call.procedure !== undefined) {
    return { procedure: identifier(call.procedure) };
  }

  return { collection: identifier(call.collection) };
}

const spanNameOf = (operation: DbOperation, target: SafeTarget) =>
  `${operation} ${target.procedure ?? target.collection}`;

function attributesOf(operation: DbOperation, target: SafeTarget): Record<string, string> {
  return {
    "db.system.name": "postgresql",
    "db.operation.name": operation,
    ...(target.collection === undefined ? {} : { "db.collection.name": target.collection }),
    ...(target.procedure === undefined ? {} : { "db.stored_procedure.name": target.procedure }),
  };
}

/** A pg error carries the SQLSTATE in `code`; a connection failure carries none. */
function createInstruments() {
  return {
    duration: metrics.getMeter(TRACER_NAME).createHistogram("db.client.operation.duration", {
      description: "Time Postgres took to answer an operation, as seen by the API.",
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

/**
 * Wraps the Pool so every query records one span (`<operation> <table|function>`,
 * child of whatever is active, usually `auth.<operation>`) and one point in
 * `db.client.operation.duration`. Anything else of `pg` is left untouched.
 *
 * Telemetry is best-effort and never changes the answer: the original error is
 * rethrown and any instrumentation failure is swallowed.
 */
export function createDatabaseClient(pool: Pool): DatabaseClient {
  return {
    async query<Row extends QueryResultRow = QueryResultRow>(
      call: DbCall,
      text: string,
      values: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      const operation = operationOf(call.operation);
      const target = targetOf(call);
      const attributes = attributesOf(operation, target);

      return trace
        .getTracer(TRACER_NAME)
        .startActiveSpan(spanNameOf(operation, target), { kind: SpanKind.CLIENT, attributes }, async (span) => {
          const startedAt = performance.now();
          let errorType: string | undefined;

          try {
            return await pool.query<Row>(text, values as unknown[]);
          } catch (error) {
            const sqlState = sqlStateOf(error);

            errorType = sqlState ?? "connection";
            span.setAttribute("error.type", errorType);

            if (isInfrastructureFailure(sqlState)) {
              span.setStatus({ code: SpanStatusCode.ERROR });

              try {
                baseLogger.warn(
                  {
                    event: "db_operation_failed",
                    operation,
                    ...(target.collection === undefined
                      ? {}
                      : { collection: target.collection }),
                    ...(target.procedure === undefined ? {} : { procedure: target.procedure }),
                    errorType,
                  },
                  "db_operation_failed",
                );
              } catch {
                // Telemetry must never take a request down.
              }
            }

            throw error;
          } finally {
            span.end();

            try {
              getInstruments().duration.record(
                (performance.now() - startedAt) / 1000,
                errorType === undefined ? attributes : { ...attributes, "error.type": errorType },
              );
            } catch {
              // Telemetry must never take a request down.
            }
          }
        });
    },
    end: () => pool.end(),
  };
}
