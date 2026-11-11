/**
 * Upper bounds, in seconds, for every duration histogram the API creates. The OpenTelemetry default
 * (0, 5, 10, 25, ... 10000) assumes milliseconds: on a metric in seconds it puts every request in
 * the first bucket and makes `histogram_quantile` meaningless.
 */
export const DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];
