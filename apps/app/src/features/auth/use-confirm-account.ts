import { useMutation } from "@tanstack/react-query";
import { setAccessToken } from "../../lib/access-token";
import { apiClient } from "../../lib/api-client";
import type { CurrentSession } from "./use-session";

/** The session the API opens when the link is confirmed (`accessToken` is the bearer token). */
export interface ConfirmAccountResponse extends CurrentSession {
  accessToken: string;
  /** ISO 8601, UTC. */
  expiresAt: string;
}

/**
 * Confirms the account behind the link token. The access token is stored in the hook's own
 * `onSuccess`, not in a callback of `mutate`: React StrictMode unmounts and remounts the page,
 * and callbacks given to `mutate` are dropped by then. Errors arrive as `ApiError`.
 */
export function useConfirmAccount() {
  return useMutation<ConfirmAccountResponse, Error, string>({
    mutationFn: (token) =>
      apiClient.post<ConfirmAccountResponse>("/auth/confirm-account", { token }),
    onSuccess: (session) => setAccessToken(session.accessToken),
  });
}
