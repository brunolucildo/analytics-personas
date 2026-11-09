import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import type { SignUpValues } from "./sign-up-validation";

export interface SignUpResponse {
  email: string;
}

/** Sends the sign-up form to the API. Errors arrive as `ApiError`. */
export function useSignUp() {
  return useMutation<SignUpResponse, Error, SignUpValues>({
    mutationFn: (values) =>
      apiClient.post<SignUpResponse>("/auth/sign-up", {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        confirmPassword: values.confirmPassword,
      }),
  });
}
