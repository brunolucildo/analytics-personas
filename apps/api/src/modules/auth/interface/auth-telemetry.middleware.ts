import { recalledErrorCode } from "../../../common/error-code";
import {
  type AuthOperation,
  type AuthOutcome,
  type AuthReason,
  reasonOf,
  recordAuthAttempt,
} from "../../../observability/auth-telemetry";
import { baseLogger } from "../../../observability/logger";

/** Last path segment of each authentication endpoint (`POST <prefix>/auth/<segment>`). */
const OPERATION_BY_SEGMENT: Readonly<Record<string, AuthOperation>> = {
  "sign-up": "sign_up",
  "confirm-account": "confirm_account",
  "sign-in": "sign_in",
  "sign-out": "sign_out",
  "forgot-password": "forgot_password",
  "reset-password": "reset_password",
  "resend-confirmation": "resend_confirmation",
};

/** The operation an HTTP request would run, or `undefined` when it is not an auth endpoint. */
export function authOperationOf(
  method: string,
  path: string,
  prefix: string,
): AuthOperation | undefined {
  if (method !== "POST") {
    return undefined;
  }

  const base = `/${prefix}/auth/`;
  const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

  if (!clean.startsWith(base)) {
    return undefined;
  }

  const segment = clean.slice(base.length);

  return Object.hasOwn(OPERATION_BY_SEGMENT, segment) ? OPERATION_BY_SEGMENT[segment] : undefined;
}

interface TelemetryRequest {
  method: string;
  path: string;
  id?: unknown;
}

interface TelemetryResponse {
  statusCode: number;
  locals?: Record<string, unknown>;
  once(event: "finish", listener: () => void): unknown;
}

type TelemetryLogger = Pick<typeof baseLogger, "info" | "warn">;

export interface AuthTelemetryOptions {
  /** Global API prefix, e.g. `api/v1`. */
  prefix: string;
  logger?: TelemetryLogger;
}

/**
 * Counts every attempt at an authentication endpoint exactly once, when the response finishes,
 * and logs it as `auth_operation`. It lives at the app level because validation (400), the rate
 * limit (429) and the session guard (401) answer before the controller runs; the status and the
 * error `code` (kept by the exception filter) are all it needs. The log carries only the closed
 * operation, outcome and reason sets plus the request id: no e-mail, IP, token or body.
 *
 * Telemetry never decides the response: any failure in here is swallowed.
 */
export function createAuthTelemetryMiddleware({
  prefix,
  logger = baseLogger,
}: AuthTelemetryOptions) {
  return (request: TelemetryRequest, response: TelemetryResponse, next: () => void): void => {
    const operation = authOperationOf(request.method, request.path, prefix);

    if (operation === undefined) {
      next();

      return;
    }

    const startedAt = process.hrtime.bigint();

    response.once("finish", () => {
      try {
        const outcome: AuthOutcome = response.statusCode < 400 ? "success" : "failure";
        const reason: AuthReason =
          outcome === "success"
            ? "none"
            : reasonOf(response.statusCode, recalledErrorCode(response));

        recordAuthAttempt({
          operation,
          outcome,
          reason,
          durationSeconds: Number(process.hrtime.bigint() - startedAt) / 1e9,
        });

        const fields = {
          event: "auth_operation",
          operation,
          outcome,
          reason,
          ...(typeof request.id === "string" ? { requestId: request.id } : {}),
        };

        if (outcome === "success") {
          logger.info(fields, "auth_operation");
        } else {
          logger.warn(fields, "auth_operation");
        }
      } catch {
        // Telemetry must never take a request down.
      }
    });

    next();
  };
}
