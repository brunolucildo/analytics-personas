import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfirmationToken } from "../domain/auth-ports";
import type {
  ConfirmationRepository,
  RenewConfirmationResult,
} from "../domain/confirm-account-ports";
import { DataAccessError } from "./data-access-error";

/**
 * `ConfirmationRepository` over Supabase. Both operations are SQL functions
 * (`auth_confirm_account` and `auth_resend_confirmation`) called through RPC with
 * the service role, so each one runs in a single transaction.
 */
export class SupabaseConfirmationRepository implements ConfirmationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async confirmByTokenHash(tokenHash: string): Promise<string | null> {
    const { data, error } = await this.client.rpc("auth_confirm_account", {
      p_token_hash: tokenHash,
    });

    if (error) {
      throw new DataAccessError("auth_confirm_account", error.code);
    }

    if (data === null) {
      return null;
    }

    if (typeof data !== "string") {
      throw new DataAccessError("auth_confirm_account", "UNEXPECTED_RESULT");
    }

    return data;
  }

  async renewForUnconfirmedUser(
    email: string,
    token: ConfirmationToken,
  ): Promise<RenewConfirmationResult> {
    const { data, error } = await this.client.rpc("auth_resend_confirmation", {
      p_email: email,
      p_token_hash: token.tokenHash,
      p_token_expires_at: token.expiresAt.toISOString(),
    });

    if (error) {
      throw new DataAccessError("auth_resend_confirmation", error.code);
    }

    if (data === null) {
      return { status: "no_action" };
    }

    if (typeof data !== "string") {
      throw new DataAccessError("auth_resend_confirmation", "UNEXPECTED_RESULT");
    }

    return { status: "created", firstName: data };
  }
}
