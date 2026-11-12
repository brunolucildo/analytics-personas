import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type TelemetryRecorder, startTelemetryRecorder } from "../../test/support/telemetry";
import { createDatabaseClient } from "./db-telemetry";
import { DURATION_BUCKETS_SECONDS } from "./duration-buckets";
import { baseLogger } from "./logger";

const EMAIL = "someone.sentinel@example.com";
const SID = "9b70d4e9-e0ba-419f-b935-2def8ce7c5f5";
const SQL = "select id from public.users where email = $1 and id = $2";

/** A Pool stand-in whose `query` resolves or rejects the way `pg` does. */
function poolWith(outcome: { rows?: unknown[] } | { error: unknown }) {
  const query = vi.fn();

  if ("error" in outcome) {
    query.mockRejectedValue(outcome.error);
  } else {
    query.mockResolvedValue({ rows: outcome.rows ?? [] } as QueryResult<QueryResultRow>);
  }

  const end = vi.fn().mockResolvedValue(undefined);

  return { pool: { query, end } as unknown as Pool, query, end };
}

describe("createDatabaseClient", () => {
  let recorder: TelemetryRecorder;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    recorder = startTelemetryRecorder();
  });

  afterAll(async () => {
    await recorder.stop();
  });

  beforeEach(async () => {
    // Metrics are delta: drain what a previous test left unread before starting from zero.
    await recorder.metric("db.client.operation.duration");
    recorder.reset();
    warnSpy = vi.spyOn(baseLogger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const failureLogs = () =>
    (warnSpy.mock.calls as unknown[][])
      .map(([fields]) => fields as Record<string, unknown>)
      .filter((fields) => fields?.event === "db_operation_failed");

  it("records a CLIENT span and a duration point for a query, without the SQL or the values", async () => {
    const { pool, query } = poolWith({ rows: [{ id: "x" }] });
    const client = createDatabaseClient(pool);

    const result = await client.query({ operation: "select", collection: "users" }, SQL, [
      EMAIL,
      SID,
    ]);

    expect(result.rows).toEqual([{ id: "x" }]);
    expect(query).toHaveBeenCalledWith(SQL, [EMAIL, SID]);

    const [span] = recorder.spans();

    expect(span?.name).toBe("select users");
    expect(span?.kind).toBe(SpanKind.CLIENT);
    expect(span?.attributes).toEqual({
      "db.system.name": "postgresql",
      "db.operation.name": "select",
      "db.collection.name": "users",
    });
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);

    const points = await recorder.metric("db.client.operation.duration");

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      value: 1,
      attributes: {
        "db.system.name": "postgresql",
        "db.operation.name": "select",
        "db.collection.name": "users",
      },
    });
    expect(points[0]?.attributes).not.toHaveProperty("error.type");
    expect(points[0]?.boundaries).toEqual(DURATION_BUCKETS_SECONDS);
  });

  it("names the SQL function of an rpc", async () => {
    const { pool } = poolWith({ rows: [] });

    await createDatabaseClient(pool).query(
      { operation: "rpc", procedure: "auth_issue_session" },
      "select public.auth_issue_session($1, $2)",
      [SID, new Date()],
    );

    expect(recorder.spans()[0]?.name).toBe("rpc auth_issue_session");
    expect(recorder.spans()[0]?.attributes).toMatchObject({
      "db.operation.name": "rpc",
      "db.stored_procedure.name": "auth_issue_session",
    });
    expect((await recorder.metric("db.client.operation.duration"))[0]?.attributes).toMatchObject({
      "db.stored_procedure.name": "auth_issue_session",
    });
  });

  it("is a child of the active span", async () => {
    const { pool } = poolWith({ rows: [] });

    await trace.getTracer("test").startActiveSpan("auth.sign_in", async (parent) => {
      await createDatabaseClient(pool).query(
        { operation: "select", collection: "users" },
        "select id from public.users",
      );
      parent.end();
    });

    const spans = recorder.spans();
    const parent = spans.find((span) => span.name === "auth.sign_in");
    const child = spans.find((span) => span.name === "select users");

    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it("collapses a name that is not a plain SQL identifier into `unknown`", async () => {
    const { pool } = poolWith({ rows: [] });
    const client = createDatabaseClient(pool);

    await client.query({ operation: "select", collection: "Users" }, "select 1");
    await client.query({ operation: "select", collection: "a-b" }, "select 1");

    expect(recorder.spans().map((span) => span.name)).toEqual(["select unknown", "select unknown"]);
  });

  it("marks an infrastructure failure as an error, labels it with the SQLSTATE and logs it", async () => {
    const failure = Object.assign(new Error("connection reset"), { code: "08006" });
    const { pool } = poolWith({ error: failure });

    await expect(
      createDatabaseClient(pool).query({ operation: "select", collection: "users" }, SQL, [EMAIL]),
    ).rejects.toBe(failure);

    const [span] = recorder.spans();

    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes).toMatchObject({ "error.type": "08006" });
    expect(span?.events).toHaveLength(0);
    expect((await recorder.metric("db.client.operation.duration"))[0]?.attributes).toMatchObject({
      "error.type": "08006",
    });
    expect(failureLogs()).toEqual([
      { event: "db_operation_failed", operation: "select", collection: "users", errorType: "08006" },
    ]);
  });

  it("records a connection failure with no SQLSTATE as `connection`", async () => {
    const failure = new TypeError("fetch failed");
    const { pool } = poolWith({ error: failure });

    await expect(
      createDatabaseClient(pool).query(
        { operation: "rpc", procedure: "auth_sign_up" },
        "select public.auth_sign_up($1)",
        [EMAIL],
      ),
    ).rejects.toBe(failure);

    expect(recorder.spans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(recorder.spans()[0]?.attributes).toMatchObject({ "error.type": "connection" });
    expect(failureLogs()).toEqual([
      { event: "db_operation_failed", operation: "rpc", procedure: "auth_sign_up", errorType: "connection" },
    ]);
  });

  it("keeps a business violation (unique_violation) out of the span status and the logs", async () => {
    const failure = Object.assign(new Error("duplicate key value"), { code: "23505" });
    const { pool } = poolWith({ error: failure });

    await expect(
      createDatabaseClient(pool).query(
        { operation: "rpc", procedure: "auth_sign_up" },
        "select public.auth_sign_up($1)",
      ),
    ).rejects.toBe(failure);

    expect(recorder.spans()[0]?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(recorder.spans()[0]?.attributes).toMatchObject({ "error.type": "23505" });
    expect((await recorder.metric("db.client.operation.duration"))[0]?.attributes).toMatchObject({
      "error.type": "23505",
    });
    expect(failureLogs()).toHaveLength(0);
  });

  it("does not log a success", async () => {
    const { pool } = poolWith({ rows: [] });

    await createDatabaseClient(pool).query(
      { operation: "select", collection: "users" },
      "select id from public.users",
    );

    expect(failureLogs()).toHaveLength(0);
  });

  it("calls pool.end() on end()", async () => {
    const { pool, end } = poolWith({ rows: [] });

    await createDatabaseClient(pool).end();

    expect(end).toHaveBeenCalledTimes(1);
  });

  it("never exposes the SQL, the values or the error message in a span, a metric or a log", async () => {
    const { pool } = poolWith({
      error: Object.assign(new Error(`duplicate key value (email)=(${EMAIL})`), { code: "23505" }),
    });
    const client = createDatabaseClient(pool);

    await client
      .query({ operation: "update", collection: "users" }, SQL, [EMAIL, "hash-sentinel", SID])
      .catch(() => undefined);

    const everything = JSON.stringify({
      spans: recorder.exportedSpans(),
      metrics: await recorder.metric("db.client.operation.duration"),
      logs: failureLogs(),
    });

    for (const secret of [EMAIL, SID, "hash-sentinel", "public.users", "where email"]) {
      expect(everything, `leaked "${secret}"`).not.toContain(secret);
    }
  });
});
