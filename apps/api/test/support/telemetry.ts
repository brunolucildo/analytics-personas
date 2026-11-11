import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";

export interface RecordedPoint {
  attributes: Record<string, unknown>;
  /** Counter increment, or the `count` of a histogram, since the last `reset()`. */
  value: number;
  /** Histogram sum (seconds, for duration histograms); `undefined` for counters. */
  sum?: number;
  /** Histogram bucket upper bounds; `undefined` for counters. */
  boundaries?: number[];
}

/**
 * Registers in-memory OpenTelemetry providers as the globals, so tests can read the spans and
 * metrics the code under test emits without the SDK, the Collector or the network. Metrics use
 * delta temporality: each `metric()` call returns only what happened since `reset()`.
 * Providers are process-global; call this once per test file (`beforeAll`) and `stop()` after.
 */
export function startTelemetryRecorder() {
  const spanExporter = new InMemorySpanExporter();
  const tracerProvider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
  });
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 3_600_000,
      }),
    ],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();

  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);

  return {
    spans(): ReadableSpan[] {
      return spanExporter.getFinishedSpans();
    },

    /** Everything a span exposes to a backend, as plain JSON (a span itself is circular). */
    exportedSpans(): unknown[] {
      return spanExporter.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: span.attributes,
        status: span.status,
        events: span.events.map((event) => ({ name: event.name, attributes: event.attributes })),
        links: span.links.length,
      }));
    },

    /** Data points of one metric (by its OpenTelemetry name) since the last `reset()`. */
    async metric(name: string): Promise<RecordedPoint[]> {
      await meterProvider.forceFlush();

      const totals = new Map<string, RecordedPoint>();

      for (const resource of metricExporter.getMetrics()) {
        for (const scope of resource.scopeMetrics) {
          for (const metric of scope.metrics) {
            if (metric.descriptor.name !== name) {
              continue;
            }

            for (const point of metric.dataPoints) {
              const key = JSON.stringify(point.attributes);
              const known = totals.get(key) ?? {
                attributes: { ...point.attributes },
                value: 0,
              };
              const histogram = point.value as
                | { count?: number; sum?: number; buckets?: { boundaries?: number[] } }
                | number;

              if (typeof histogram === "number") {
                known.value += histogram;
              } else {
                known.value += histogram.count ?? 0;
                known.sum = (known.sum ?? 0) + (histogram.sum ?? 0);
                known.boundaries = histogram.buckets?.boundaries;
              }

              totals.set(key, known);
            }
          }
        }
      }

      return [...totals.values()];
    },

    reset(): void {
      spanExporter.reset();
      metricExporter.reset();
    },

    async stop(): Promise<void> {
      await meterProvider.shutdown();
      await tracerProvider.shutdown();
      contextManager.disable();
      context.disable();
      trace.disable();
      metrics.disable();
    },
  };
}

export type TelemetryRecorder = ReturnType<typeof startTelemetryRecorder>;
