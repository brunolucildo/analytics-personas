import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { clearAccessToken } from "../../lib/access-token";
import { apiClient } from "../../lib/api-client";

/**
 * Ends the session. The API call is best effort: whatever its outcome (204, 401, 5xx or no
 * network) the token is dropped, the query cache emptied and the page sent to sign-in, so a
 * failure never leaves someone stuck signed in. Cleanup lives in `onSettled` of the hook (not
 * of `mutate`) so it still runs if the button unmounts while the request is in flight.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation<void, Error, void>({
    mutationFn: () => apiClient.post<void>("/auth/sign-out", undefined),
    onSettled: async () => {
      clearAccessToken();
      queryClient.clear();
      await router.navigate({ to: "/auth/sign-in", replace: true });
    },
  });
}
