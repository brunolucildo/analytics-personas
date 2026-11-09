import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PasswordResetRepository,
  PasswordResetToken,
  RequestPasswordResetResult,
} from "../domain/password-reset-ports";
import { DataAccessError } from "./data-access-error";

/**
 * `PasswordResetRepository` over Supabase. The atomic part (confirmed account
 * lookup, invalidation of the earlier tokens and the insert of the new one)
 * lives in the SQL function `auth_request_password_reset`, called through RPC
 * with the service role.
 */
export class SupabasePasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createForConfirmedUser(
    email: string,
    token: PasswordResetToken,
  ): Promise<RequestPasswordResetResult> {
    const { data, error } = await this.client.rpc("auth_request_password_reset", {
      p_email: email,
      p_token_hash: token.tokenHash,
      p_token_expires_at: token.expiresAt.toISOString(),
    });

    if (error) {
      throw new DataAccessError("auth_request_password_reset", error.code);
    }

    if (data === null) {
      return { status: "no_action" };
    }

    if (typeof data !== "string") {
      throw new DataAccessError("auth_request_password_reset", "UNEXPECTED_RESULT");
    }

    return { status: "created", firstName: data };
  }
}
