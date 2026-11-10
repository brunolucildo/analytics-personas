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

describe("provisioned Grafana dashboards", () => {
  it("ships the API and Auth dashboards", () => {
    expect(dashboardFiles.sort()).toEqual(["api.json", "auth.json"]);
    expect(loadDashboard("api.json")).toMatchObject({ uid: "rondo-api", title: "Rondo — API" });
    expect(loadDashboard("auth.json")).toMatchObject({ uid: "rondo-auth", title: "Rondo — Auth" });
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

      for (const panel of dashboard.panels.filter((item) => item.type !== "text")) {
        expect(panel.targets?.length, `panel "${panel.title}" has no target`).toBeGreaterThan(0);

        for (const target of panel.targets ?? []) {
          expect((target.expr ?? target.query ?? "").length).toBeGreaterThan(0);
        }
      }
    });

    it("points every data panel at a provisioned datasource uid", () => {
      for (const panel of dashboard.panels.filter((item) => item.type !== "text")) {
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

  it("queries the labels and the route the API actually emits", () => {
    const api = JSON.stringify(loadDashboard("api.json"));
    const auth = JSON.stringify(loadDashboard("auth.json"));

    expect(api).toContain("http_route");
    expect(api).toContain("http_server_request_duration_seconds_bucket");
    expect(auth).toContain("auth_operations_total");
    expect(auth).toContain("auth_operation_duration_seconds_bucket");

    for (const label of ["operation", "outcome", "reason"]) {
      expect(auth).toContain(label);
    }
  });

  it("only filters auth by operations and reasons that exist in the code", () => {
    const auth = JSON.stringify(loadDashboard("auth.json"));
    const used = [...auth.matchAll(/operation=\\"([a-z_]+)\\"/g)].map((match) => match[1]);

    for (const operation of used) {
      expect(AUTH_OPERATIONS as readonly string[]).toContain(operation);
    }

    const reasons = [...auth.matchAll(/reason=\\"([a-z_]+)\\"/g)].map((match) => match[1]);

    for (const reason of reasons) {
      expect(AUTH_FAILURE_REASONS as readonly string[]).toContain(reason);
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
