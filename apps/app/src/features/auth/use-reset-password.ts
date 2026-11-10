import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clearAccessToken } from "../../lib/access-token";
import { apiClient } from "../../lib/api-client";

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

/**
 * Sets a new password with the link token. The API answers `204` and opens no session; every
 * session of the user was revoked, so on success the stored token (if any) and the cached
 * session are dropped here, in the hook's own `onSuccess` (not in a callback of `mutate`, which
 * React StrictMode drops when it remounts the page). Errors arrive as `ApiError`.
 */
export function useResetPassword() {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, ResetPasswordRequest>({
    mutationFn: (request) =>
      apiClient.post<unknown>("/auth/reset-password", {
        token: request.token,
        password: request.password,
        confirmPassword: request.confirmPassword,
      }),
    onSuccess: () => {
      clearAccessToken();
      queryClient.removeQueries({ queryKey: ["session"] });
    },
  });
}
