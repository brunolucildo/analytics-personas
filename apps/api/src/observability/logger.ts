import { type LoggerService } from "@nestjs/common";
import { pino } from "pino";

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: process.env.OTEL_SERVICE_NAME ?? "rondo-api",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

function describe(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  return value;
}

export class StructuredLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    baseLogger.info({ details: optionalParams.map(describe) }, String(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    baseLogger.error({ details: optionalParams.map(describe) }, String(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    baseLogger.warn({ details: optionalParams.map(describe) }, String(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    baseLogger.debug({ details: optionalParams.map(describe) }, String(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    baseLogger.trace({ details: optionalParams.map(describe) }, String(message));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    baseLogger.fatal({ details: optionalParams.map(describe) }, String(message));
  }
}

export { baseLogger };
