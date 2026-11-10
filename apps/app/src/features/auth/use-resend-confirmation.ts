import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { ResendConfirmationValues } from "./resend-confirmation-validation";

/** The API answers `202 {}` in every case: there is nothing to read from the body. */
export type ResendConfirmationResponse = Record<string, never>;

/** Asks the API for a new confirmation link. Errors arrive as `ApiError`. */
export function useResendConfirmation() {
  return useMutation<ResendConfirmationResponse, Error, ResendConfirmationValues>({
    mutationFn: (values) =>
      apiClient.post<ResendConfirmationResponse>("/auth/resend-confirmation", {
        email: values.email,
      }),
  });
}
