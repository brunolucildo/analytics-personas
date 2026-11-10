import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfirmationToken,
  CreateUserResult,
  NewUser,
  UserRepository,
} from "../domain/auth-ports";
import { DataAccessError } from "./data-access-error";

/**
 * `UserRepository` over Supabase. The atomic part (user + token in one
 * transaction, with the unique e-mail deciding races) lives in the SQL function
 * `auth_sign_up`, called through RPC with the service role.
 */
export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createWithConfirmationToken(
    user: NewUser,
    token: ConfirmationToken,
  ): Promise<CreateUserResult> {
    const { data, error } = await this.client.rpc("auth_sign_up", {
      p_first_name: user.firstName,
      p_last_name: user.lastName,
      p_email: user.email,
      p_password_hash: user.passwordHash,
      p_token_hash: token.tokenHash,
      p_token_expires_at: token.expiresAt.toISOString(),
    });

    if (error) {
      throw new DataAccessError("auth_sign_up", error.code);
    }

    if (data === null) {
      return { status: "email_taken" };
    }

    if (typeof data !== "string") {
      throw new DataAccessError("auth_sign_up", "UNEXPECTED_RESULT");
    }

    return { status: "created", userId: data };
  }
}
