import { HttpException } from "@nestjs/common";

export interface ApiErrorDetail {
  field?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: ApiErrorDetail[];
  };
}

/**
 * Domain-facing HTTP error. The global filter serializes it into the
 * `{"error":{"code","message","details"}}` envelope shared by every endpoint.
 */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super({ code, message, details }, status);
  }
}
