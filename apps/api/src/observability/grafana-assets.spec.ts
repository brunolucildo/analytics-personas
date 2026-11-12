import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_FAILURE_REASONS, AUTH_OPERATIONS } from "./auth-telemetry";

const GRAFANA = resolve(__dirname, "../../../../infra/grafana");
const DASHBOARDS = join(GRAFANA, "dashboards");
const KNOWN_DATASOURCES = new Set(["mimir", "loki", "tempo"]);

interface Target {
  expr?: string;
  query?: string;
  [key: string]: unknown;
}

interface Panel {
  id: number;
  type: string;
  title: string;
  datasource?: { type: string; uid: string };
  targets?: Target[];
  gridPos: { h: number; w: number; x: number; y: number };
}

interface Dashboard {
  uid: string;
  title: string;
  panels: Panel[];
}

function loadDashboard(file: string): Dashboard {
  return JSON.parse(readFileSync(join(DASHBOARDS, file), "utf8")) as Dashboard;
}

const dashboardFiles = readdirSync(DASHBOARDS).filter((file) => file.endsWith(".json"));

// Panels that draw their own data: rows, text and the Grafana alert list carry no query.
const NO_QUERY_PANELS = new Set(["row", "text", "alertlist"]);

describe("provisioned Grafana dashboards", () => {
  it("ships the API observability dashboard", () => {
    expect(dashboardFiles.sort()).toEqual(["api-observability.json"]);
    expect(loadDashboard("api-observability.json")).toMatchObject({
      uid: "rondo-api-observability",
      title: "Rondo — Observabilidade da API",
    });
  });

  it("has unique dashboard uids", () => {
    const uids = dashboardFiles.map((file) => loadDashboard(file).uid);

    expect(new Set(uids).size).toBe(uids.length);
  });

  describe.each(dashboardFiles)("%s", (file) => {
    const dashboard = loadDashboard(file);

    it("has unique panel ids and a query on every data panel", () => {
      const ids = dashboard.panels.map((panel) => panel.id);

      expect(new Set(ids).size).toBe(ids.length);

      for (const panel of dashboard.panels.filter((item) => !NO_QUERY_PANELS.has(item.type))) {
        expect(panel.targets?.length, `panel "${panel.title}" has no target`).toBeGreaterThan(0);

        for (const target of panel.targets ?? []) {
          expect((target.expr ?? target.query ?? "").length).toBeGreaterThan(0);
        }
      }
    });

    it("points every data panel at a provisioned datasource uid", () => {
      for (const panel of dashboard.panels.filter((item) => !NO_QUERY_PANELS.has(item.type))) {
        expect(
          KNOWN_DATASOURCES.has(panel.datasource?.uid ?? ""),
          `panel "${panel.title}" uses an unknown datasource`,
        ).toBe(true);
      }
    });

    it("never overlaps panels or leaves the 24 column grid", () => {
      for (const panel of dashboard.panels) {
        expect(panel.gridPos.x + panel.gridPos.w).toBeLessThanOrEqual(24);
      }

      for (const [index, first] of dashboard.panels.entries()) {
        for (const second of dashboard.panels.slice(index + 1)) {
          const overlapsX =
            first.gridPos.x < second.gridPos.x + second.gridPos.w &&
            second.gridPos.x < first.gridPos.x + first.gridPos.w;
          const overlapsY =
            first.gridPos.y < second.gridPos.y + second.gridPos.h &&
            second.gridPos.y < first.gridPos.y + first.gridPos.h;

          expect(overlapsX && overlapsY, `"${first.title}" overlaps "${second.title}"`).toBe(false);
        }
      }
    });
  });

  it("queries the metrics, labels and route the API actually emits", () => {
    const dashboard = JSON.stringify(loadDashboard("api-observability.json"));

    for (const expected of [
      "http_route",
      "http_server_request_duration_seconds_bucket",
      "http_client_request_duration_seconds_bucket",
      "auth_operations_total",
      "auth_operation_duration_seconds_bucket",
      "nodejs_eventloop_utilization_ratio",
      "v8js_memory_heap_used_bytes",
      "db_client_operation_duration_seconds_bucket",
      "db_operation_failed",
      "postgresql_backends",
      "postgresql_connection_max",
      "postgresql_blocks_read_total",
      "auth_hash_queued",
      "auth_hash_queue_wait_seconds_bucket",
      "auth_hash_rejected_total",
      "k6_http_reqs_total",
      "k6_http_req_duration_p95",
      "k6_vus",
      "operation",
      "outcome",
      "reason",
    ]) {
      expect(dashboard, `missing "${expected}"`).toContain(expected);
    }
  });

  it("only filters auth by operations and reasons that exist in the code", () => {
    const dashboard = JSON.stringify(loadDashboard("api-observability.json"));
    const used = [...dashboard.matchAll(/operation=\\"([a-z_]+)\\"/g)].map((match) => match[1]);

    expect(used.length).toBeGreaterThan(0);

    for (const operation of used) {
      expect(AUTH_OPERATIONS as readonly string[]).toContain(operation);
    }

    const reasons = [...dashboard.matchAll(/reason=\\"([a-z_]+)\\"/g)].map((match) => match[1]);

    for (const reason of reasons) {
      expect(AUTH_FAILURE_REASONS as readonly string[]).toContain(reason);
    }
  });

  it("has no reference to Supabase or PostgREST and covers the database through the pool", () => {
    const dashboard = JSON.stringify(loadDashboard("api-observability.json"));
    const alerts = readFileSync(join(GRAFANA, "provisioning/alerting/rondo-alerts.yaml"), "utf8");

    for (const forbidden of [/supabase/i, /postgrest/i, /server_address=~\\?"\.\*supabase/i]) {
      expect(dashboard).not.toMatch(forbidden);
      expect(alerts).not.toMatch(forbidden);
    }

    expect(alerts).not.toContain("rondo-supabase");
    expect(dashboard).toContain('job=\\"rondo-postgres\\"');
    // The pool spans carry the SQLSTATE as `error.type`, not an HTTP status.
    expect(dashboard).not.toContain("db.response.status_code");
  });

  it("never selects span attributes that carry personal data", () => {
    const dashboard = JSON.stringify(loadDashboard("api-observability.json"));

    // The full URL and query string can hold e-mails and tokens; IP and user agent identify people.
    for (const forbidden of [
      "url.full",
      "url.query",
      "client.address",
      "network.peer.address",
      "user_agent.original",
    ]) {
      expect(dashboard, `forbidden attribute "${forbidden}"`).not.toContain(forbidden);
    }
  });
});

describe("provisioned Grafana datasources", () => {
  const yaml = readFileSync(join(GRAFANA, "provisioning/datasources/datasources.yaml"), "utf8");

  it("links a Loki log to its Tempo trace through trace_id", () => {
    expect(yaml).toMatch(/derivedFields:/);
    expect(yaml).toMatch(/datasourceUid: tempo/);
    expect(yaml).toMatch(/matcherRegex: trace_id/);
    // `$$` is how provisioning writes a literal `$`.
    expect(yaml).toContain("$${__value.raw}");
  });

  it("links a Tempo trace back to its Loki logs", () => {
    expect(yaml).toMatch(/tracesToLogsV2:/);
    expect(yaml).toMatch(/datasourceUid: loki/);
    expect(yaml).toContain("$${__trace.traceId}");
  });
});

describe("provisioned Grafana alert rules", () => {
  const yaml = readFileSync(join(GRAFANA, "provisioning/alerting/rondo-alerts.yaml"), "utf8");
  const uids = [...yaml.matchAll(/^ {6}- uid: "([^"]+)"/gm)].map((match) => match[1] as string);
  const titles = [...yaml.matchAll(/^ {8}title: "([^"]+)"/gm)].map((match) => match[1] as string);

  it("defines the rules in the Rondo folder with unique, short uids and titles", () => {
    expect(uids.length).toBeGreaterThanOrEqual(15);
    expect(new Set(uids).size).toBe(uids.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toHaveLength(uids.length);

    for (const uid of uids) {
      expect(uid.length, `uid "${uid}" is longer than Grafana's 40 characters`).toBeLessThanOrEqual(
        40,
      );
    }

    expect(yaml).toMatch(/folder: "Rondo"/);
  });

  it("gives every rule a pending period, a severity and a threshold", () => {
    expect([...yaml.matchAll(/^ {8}for: "/gm)]).toHaveLength(uids.length);
    expect([...yaml.matchAll(/^ {10}severity: "(critical|warning)"/gm)]).toHaveLength(uids.length);
    expect([...yaml.matchAll(/type: "threshold"/g)]).toHaveLength(uids.length);
  });

  it("queries only the provisioned datasources", () => {
    const used = [...yaml.matchAll(/datasourceUid: "([^"]+)"/g)].map((match) => match[1] as string);

    for (const uid of used) {
      expect(KNOWN_DATASOURCES.has(uid) || uid === "__expr__", `unknown datasource "${uid}"`).toBe(
        true,
      );
    }
  });

  it("alerts on the API, auth, dependencies and Postgres, and on a stopped API or database", () => {
    for (const expected of [
      "absent_over_time(nodejs_eventloop_utilization_ratio",
      "absent_over_time(postgresql_backends",
      "http_server_request_duration_seconds_count",
      "db_operation_failed",
      "unhandled_exception",
      "postgresql_deadlocks_total",
      "postgresql_connection_max",
      "invalid_credentials",
    ]) {
      expect(yaml, `missing "${expected}"`).toContain(expected);
    }
  });
});
