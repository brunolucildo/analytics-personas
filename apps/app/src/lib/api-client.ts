import { clearAccessToken, getAccessToken } from "./access-token";

export interface ApiErrorDetail {
  field?: string;
  message?: string;
  [key: string]: unknown;
}

/** Failure of an API call: HTTP status (0 for network), envelope `code`, message and details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The API says the session is gone: missing, expired, revoked or invalid token. */
export function isUnauthenticated(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED";
}

export interface ApiClientOptions {
  /** Includes the version prefix, for example `http://localhost:3002/api/v1`. */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Read on every call; when it returns a token the request carries `Authorization: Bearer`. */
  getToken?: () => string | null;
  /** Runs when a response is 401 `UNAUTHENTICATED`, before the error is thrown. */
  onUnauthenticated?: () => void;
}

export interface ApiClient {
  get<TResponse>(path: string): Promise<TResponse>;
  post<TResponse>(path: string, body: unknown): Promise<TResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toApiError(status: number, payload: unknown): ApiError {
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;

  if (
    envelope !== undefined &&
    typeof envelope.code === "string" &&
    typeof envelope.message === "string"
  ) {
    const details = Array.isArray(envelope.details) ? (envelope.details as ApiErrorDetail[]) : [];

    return new ApiError(status, envelope.code, envelope.message, details);
  }

  return new ApiError(status, "UNKNOWN_ERROR", "The server returned an unexpected response.");
}

export function createApiClient({
  baseUrl,
  fetch: fetcher,
  getToken,
  onUnauthenticated,
}: ApiClientOptions): ApiClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<TResponse>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<TResponse> {
    // Resolved on each call so tests (and polyfills) can replace the global fetch.
    const send = fetcher ?? globalThis.fetch;
    let response: Response;

    try {
      const token = getToken?.() ?? null;
      const headers: Record<string, string> = { accept: "application/json" };

      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }

      if (token !== null) {
        headers.authorization = `Bearer ${token}`;
      }

      response = await send(`${root}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server.");
    }

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const failure = toApiError(response.status, payload);

      if (isUnauthenticated(failure)) {
        onUnauthenticated?.();
      }

      throw failure;
    }

    return payload as TResponse;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
  };
}

/** Default client: `VITE_API_URL` (public, no secrets) plus the `/api/v1` prefix. */
export const apiClient = createApiClient({
  baseUrl: `${import.meta.env.VITE_API_URL ?? "http://localhost:3002"}/api/v1`,
  getToken: getAccessToken,
  onUnauthenticated: clearAccessToken,
});
