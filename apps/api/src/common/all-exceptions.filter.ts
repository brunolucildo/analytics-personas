import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { baseLogger } from "../observability/logger";
import { ApiException, type ApiErrorBody } from "./api-exception";

interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
};

const MESSAGE_BY_CODE: Record<string, string> = {
  VALIDATION_FAILED: "The request is invalid.",
  UNAUTHENTICATED: "Authentication required.",
  FORBIDDEN: "You do not have access to this resource.",
  NOT_FOUND: "Resource not found.",
  RATE_LIMITED: "Too many requests. Try again later.",
  REQUEST_FAILED: "The request could not be processed.",
  INTERNAL_ERROR: "Something went wrong. Try again later.",
};

function clientErrorStatus(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  if (typeof exception === "object" && exception !== null) {
    const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
    const candidate = typeof status === "number" ? status : statusCode;

    if (typeof candidate === "number" && candidate >= 400 && candidate < 500) {
      return candidate;
    }
  }

  return undefined;
}

function envelope(code: string, message: string, details: ApiErrorBody["error"]["details"] = []) {
  return { error: { code, message, details } } satisfies ApiErrorBody;
}

export function toErrorResponse(exception: unknown): { status: number; body: ApiErrorBody } {
  if (exception instanceof ApiException) {
    return {
      status: exception.getStatus(),
      body: envelope(exception.code, exception.message, exception.details),
    };
  }

  const status = clientErrorStatus(exception);

  if (status !== undefined && status < 500) {
    const code = CODE_BY_STATUS[status] ?? "REQUEST_FAILED";

    return {
      status,
      body: envelope(code, MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.REQUEST_FAILED!),
    };
  }

  return {
    status: 500,
    body: envelope("INTERNAL_ERROR", MESSAGE_BY_CODE.INTERNAL_ERROR!),
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponse>();
    const request = http.getRequest<{ id?: unknown }>();
    const { status, body } = toErrorResponse(exception);

    if (status >= 500) {
      // The stack goes to the structured log only, never to the response.
      baseLogger.error({ requestId: request.id, err: exception }, "unhandled_exception");
    }

    response.status(status).json(body);
  }
}
