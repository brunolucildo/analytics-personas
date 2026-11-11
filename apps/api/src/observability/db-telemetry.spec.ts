import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type TelemetryRecorder, startTelemetryRecorder } from "../../test/support/telemetry";
import { DURATION_BUCKETS_SECONDS } from "./duration-buckets";
import { createInstrumentedFetch, describeDbCall } from "./db-telemetry";
import { baseLogger } from "./logger";

const BASE = "https://project.supabase.co";
const EMAIL = "someone.sentinel@example.com";
const SID = "9b70d4e9-e0ba-419f-b935-2def8ce7c5f5";

describe("describeDbCall", () => {
  it("maps PostgREST table calls to the SQL operation and the table", () => {
    expect(describeDbCall("GET", `${BASE}/rest/v1/users?select=id`)).toEqual({
      operation: "select",
      collection: "users",
    });
    expect(describeDbCall("HEAD", `${BASE}/rest/v1/sessions`)).toEqual({
      operation: "select",
      collection: "sessions",
    });
    expect(describeDbCall("POST", `${BASE}/rest/v1/auth_tokens`)).toEqual({
      operation: "insert",
      collection: "auth_tokens",
    });
    expect(describeDbCall("patch", `${BASE}/rest/v1/sessions?id=eq.x`)).toEqual({
      operation: "update",
      collection: "sessions",
    });
    expect(describeDbCall("DELETE", `${BASE}/rest/v1/users?id=eq.x`)).toEqual({
      operation: "delete",
      collection: "users",
    });
    expect(describeDbCall("PUT", `${BASE}/rest/v1/users`)).toEqual({
      operation: "other",
      collection: "users",
    });
  });

  it("maps an RPC to the SQL function, whatever the HTTP method", () => {
    expect(describeDbCall("POST", `${BASE}/rest/v1/rpc/auth_sign_up`)).toEqual({
      operation: "rpc",
      procedure: "auth_sign_up",
    });
  });

  it("collapses a name that is not a plain SQL identifier into `unknown`", () => {
    expect(describeDbCall("GET", `${BASE}/rest/v1/Users`)?.collection).toBe("unknown");
    expect(describeDbCall("GET", `${BASE}/rest/v1/a-b`)?.collection).toBe("unknown");
    expect(describeDbCall("POST", `${BASE}/rest/v1/rpc/Drop%20Table`)?.procedure).toBe("unknown");
    expect(describeDbCall("GET", `${BASE}/rest/v1/`)?.collection).toBe("unknown");
  });

  it("ignores everything that is not the PostgREST data API", () => {
    expect(describeDbCall("POST", `${BASE}/auth/v1/token`)).toBeUndefined();
    expect(describeDbCall("GET", "https://sandbox.api.mailtrap.io/api/send")).toBeUndefined();
    expect(describeDbCall("GET", "not a url")).toBeUndefined();
  });
});

describe("createInstrumentedFetch", () => {
  let recorder: TelemetryRecorder;

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
  });

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(baseLogger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const failureLogs = () =>
    (warnSpy.mock.calls as unknown[][])
      .map(([fields]) => fields as Record<string, unknown>)
      .filter((fields) => fields?.event === "db_operation_failed");

  const respond = (status: number) =>
    vi.fn<typeof fetch>(async () => new Response("{}", { status }));

  it("records a CLIENT span and a duration point for a table query, without the query string", async () => {
    const baseFetch = respond(200);
    const fetchDb = createInstrumentedFetch(baseFetch);

    const response = await fetchDb(`${BASE}/rest/v1/users?select=id&email=eq.${EMAIL}`, {
      method: "GET",
      headers: { authorization: "Bearer service-role-secret" },
    });

    expect(response.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);

    const [span] = recorder.spans();

    expect(span?.name).toBe("select users");
    expect(span?.kind).toBe(SpanKind.CLIENT);
    expect(span?.attributes).toEqual({
      "db.system.name": "postgresql",
      "db.operation.name": "select",
      "db.collection.name": "users",
      "db.response.status_code": "200",
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

  it("names the SQL function of an RPC", async () => {
    await createInstrumentedFetch(respond(200))(`${BASE}/rest/v1/rpc/auth_issue_session`, {
      method: "POST",
      body: JSON.stringify({ p_user_id: SID }),
    });

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
    await trace.getTracer("test").startActiveSpan("auth.sign_in", async (parent) => {
      await createInstrumentedFetch(respond(200))(`${BASE}/rest/v1/users`, { method: "GET" });
      parent.end();
    });

    const spans = recorder.spans();
    const parent = spans.find((span) => span.name === "auth.sign_in");
    const child = spans.find((span) => span.name === "select users");

    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
  });

  it("marks a 5xx as an error and labels the metric with the status", async () => {
    const response = await createInstrumentedFetch(respond(503))(`${BASE}/rest/v1/users`, {
      method: "GET",
    });

    expect(response.status).toBe(503);
    expect(recorder.spans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(recorder.spans()[0]?.attributes).toMatchObject({
      "db.response.status_code": "503",
      "error.type": "503",
    });
    expect((await recorder.metric("db.client.operation.duration"))[0]?.attributes).toMatchObject({
      "error.type": "503",
    });
  });

  it("logs db_operation_failed for a 5xx and a network failure, with nothing from the query", async () => {
    await createInstrumentedFetch(respond(502))(`${BASE}/rest/v1/users?email=eq.${EMAIL}`, {
      method: "GET",
    });
    await createInstrumentedFetch(
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    )(`${BASE}/rest/v1/rpc/auth_sign_up`, {
      method: "POST",
      body: JSON.stringify({ e: EMAIL }),
    }).catch(() => undefined);

    expect(failureLogs()).toEqual([
      { event: "db_operation_failed", operation: "select", collection: "users", errorType: "502" },
      {
        event: "db_operation_failed",
        operation: "rpc",
        procedure: "auth_sign_up",
        errorType: "network",
      },
    ]);
    expect(JSON.stringify(failureLogs())).not.toContain(EMAIL);
  });

  it("does not log a success or a 4xx", async () => {
    await createInstrumentedFetch(respond(200))(`${BASE}/rest/v1/users`, { method: "GET" });
    await createInstrumentedFetch(respond(409))(`${BASE}/rest/v1/users`, { method: "POST" });

    expect(failureLogs()).toHaveLength(0);
  });

  it("keeps a 4xx out of the span status: it is usually business flow", async () => {
    await createInstrumentedFetch(respond(406))(`${BASE}/rest/v1/sessions?id=eq.${SID}`, {
      method: "GET",
    });

    expect(recorder.spans()[0]?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(recorder.spans()[0]?.attributes).toMatchObject({ "error.type": "406" });
    expect((await recorder.metric("db.client.operation.duration"))[0]?.attributes).toMatchObject({
      "error.type": "406",
    });
  });

  it("records a network failure as `network` and rethrows the original error", async () => {
    const failure = new TypeError("fetch failed");
    const baseFetch = vi.fn<typeof fetch>(async () => {
      throw failure;
    });

    await expect(
      createInstrumentedFetch(baseFetch)(`${BASE}/rest/v1/users`, { method: "GET" }),
    ).rejects.toBe(failure);

    expect(recorder.spans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(recorder.spans()[0]?.attributes).toMatchObject({ "error.type": "network" });
    expect((await recorder.metric("db.client.operation.duration"))[0]?.attributes).toMatchObject({
      "error.type": "network",
    });
    // No exception event: its message can carry values.
    expect(recorder.spans()[0]?.events).toHaveLength(0);
  });

  it("passes a call that is not PostgREST through with no span and no metric", async () => {
    const baseFetch = respond(200);

    await createInstrumentedFetch(baseFetch)("https://sandbox.api.mailtrap.io/api/send", {
      method: "POST",
    });

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(recorder.spans()).toHaveLength(0);
    expect(await recorder.metric("db.client.operation.duration")).toHaveLength(0);
  });

  it("reads the URL and the method from a Request or a URL object", async () => {
    await createInstrumentedFetch(respond(200))(
      new Request(`${BASE}/rest/v1/auth_tokens?user_id=eq.${SID}`, { method: "DELETE" }),
    );
    await createInstrumentedFetch(respond(200))(new URL(`${BASE}/rest/v1/users`), {
      method: "PATCH",
    });

    expect(recorder.spans().map((span) => span.name)).toEqual([
      "delete auth_tokens",
      "update users",
    ]);
  });

  it("never exposes the query string, the body or any header in a span or a metric", async () => {
    await createInstrumentedFetch(respond(200))(
      `${BASE}/rest/v1/users?select=id&email=eq.${encodeURIComponent(EMAIL)}&id=eq.${SID}`,
      {
        method: "PATCH",
        headers: { authorization: "Bearer service-role-secret", apikey: "service-role-secret" },
        body: JSON.stringify({ password_hash: "hash-sentinel", email: EMAIL }),
      },
    );

    const everything = JSON.stringify({
      spans: recorder.exportedSpans(),
      metrics: await recorder.metric("db.client.operation.duration"),
    });

    for (const secret of [
      EMAIL,
      encodeURIComponent(EMAIL),
      SID,
      "hash-sentinel",
      "service-role-secret",
      "project.supabase.co",
      "select=id",
    ]) {
      expect(everything, `leaked "${secret}"`).not.toContain(secret);
    }
  });
});
