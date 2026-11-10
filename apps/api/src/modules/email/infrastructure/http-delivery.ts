import { EmailDeliveryError } from "../domain/email-delivery-error";

export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

/** Maps an HTTP status from a provider API to a typed delivery error. */
export function classifyStatus(status: number): EmailDeliveryError {
  if (status === 401 || status === 403) {
    return new EmailDeliveryError("PROVIDER_UNAUTHORIZED", false);
  }

  if (status === 429) {
    return new EmailDeliveryError("RATE_LIMITED", true);
  }

  if (status === 408 || status >= 500) {
    return new EmailDeliveryError("PROVIDER_UNAVAILABLE", true);
  }

  return new EmailDeliveryError("PROVIDER_REJECTED", false);
}

/**
 * POSTs JSON to a provider API. The response body is never read or kept: it
 * can echo the recipient. Only the status decides the outcome.
 */
export async function postJson(
  fetchFunction: FetchFunction,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;

  try {
    response = await fetchFunction(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new EmailDeliveryError(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR", true);
  }

  await response.body?.cancel().catch(() => undefined);

  if (!response.ok) {
    throw classifyStatus(response.status);
  }
}
