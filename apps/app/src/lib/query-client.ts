import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isUnauthenticated } from "./api-client";

/**
 * The app's `QueryClient`. Any query or mutation answered with 401 `UNAUTHENTICATED`
 * (the API dropped the session) runs `onUnauthenticated`; the API client has already
 * cleared the stored token by then, so that handler only has to leave the page.
 */
export function createQueryClient(onUnauthenticated: () => void): QueryClient {
  const handleError = (error: unknown) => {
    if (isUnauthenticated(error)) {
      onUnauthenticated();
    }
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
  });
}
