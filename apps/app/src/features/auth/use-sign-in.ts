import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setAccessToken } from "../../lib/access-token";
import { apiClient } from "../../lib/api-client";
import type { SignInValues } from "./sign-in-validation";
import type { CurrentSession } from "./use-session";

/** The session the API opens (`accessToken` is the bearer token). Same shape as the confirmation. */
export interface SignInResponse extends CurrentSession {
  accessToken: string;
  /** ISO 8601, UTC. */
  expiresAt: string;
}

/**
 * Signs in with e-mail and password. The token is stored, and the user is put in the session
 * cache under that token, in the hook's own `onSuccess` (not in a callback of `mutate`, which
 * React StrictMode drops when it remounts the page): `/app` then shows the home without a
 * second round trip. Errors arrive as `ApiError`.
 */
export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation<SignInResponse, Error, SignInValues>({
    mutationFn: (values) =>
      apiClient.post<SignInResponse>("/auth/sign-in", {
        email: values.email,
        password: values.password,
      }),
    onSuccess: (session) => {
      setAccessToken(session.accessToken);
      queryClient.setQueryData<CurrentSession>(["session", session.accessToken], {
        user: session.user,
      });
    },
  });
}
