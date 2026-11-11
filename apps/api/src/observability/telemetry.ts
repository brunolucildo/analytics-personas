import { randomUUID } from "node:crypto";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { outgoingUrlAttributes, redactHttpRequestSpan } from "./span-redaction";

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318").replace(
  /\/$/,
  "",
);

const timeoutMillis = Number(process.env.OTEL_EXPORTER_OTLP_TIMEOUT ?? 3000);

const sdk = new NodeSDK({
  // Sem detectores de host/processo: evitam exportar nome da máquina e caminhos locais.
  resourceDetectors: [],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "rondo-api",
    // One random id per process: it becomes the `instance` label in Mimir. Without it two API
    // processes (dev and a load test, or two replicas) write to the same series and their
    // counters overwrite each other. Not personal data; a new one on every restart.
    "service.instance.id": randomUUID(),
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    timeoutMillis,
  }),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        timeoutMillis,
      }),
      exportIntervalMillis: 15_000,
      exportTimeoutMillis: timeoutMillis,
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
        timeoutMillis,
      }),
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Query strings carry PostgREST filters (e-mail, session id) and client input; IPs identify people.
      "@opentelemetry/instrumentation-http": { requestHook: redactHttpRequestSpan },
      "@opentelemetry/instrumentation-undici": { startSpanHook: outgoingUrlAttributes },
    }),
  ],
});

if (process.env.OTEL_SDK_DISABLED !== "true") {
  sdk.start();

  const shutdown = () => {
    void sdk.shutdown().finally(() => process.exit(0));
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
