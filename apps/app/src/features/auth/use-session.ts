import { useQuery } from "@tanstack/react-query";
import { getAccessToken } from "../../lib/access-token";
import { apiClient } from "../../lib/api-client";

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface CurrentSession {
  user: SessionUser;
}

/**
 * The session of the stored token. The token is part of the key, so a new login (or a
 * sign-out) never reuses what another token fetched. Without a token the query is off:
 * nothing calls the API.
 */
export function useSession() {
  const token = getAccessToken();

  return useQuery({
    queryKey: ["session", token],
    queryFn: () => apiClient.get<CurrentSession>("/auth/session"),
    enabled: token !== null,
    // 401 and network errors are shown, not retried; the screen offers "Try again".
    retry: false,
    staleTime: 30_000,
  });
}
