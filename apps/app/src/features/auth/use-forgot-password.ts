import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { ForgotPasswordValues } from "./forgot-password-validation";

/** The API answers `202 {}` in every case: there is nothing to read from the body. */
export type ForgotPasswordResponse = Record<string, never>;

/** Asks the API for a password reset link. Errors arrive as `ApiError`. */
export function useForgotPassword() {
  return useMutation<ForgotPasswordResponse, Error, ForgotPasswordValues>({
    mutationFn: (values) =>
      apiClient.post<ForgotPasswordResponse>("/auth/forgot-password", { email: values.email }),
  });
}
