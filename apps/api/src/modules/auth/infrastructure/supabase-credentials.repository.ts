import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredentialsRepository, StoredCredentials } from "../domain/sign-in-ports";
import { DataAccessError } from "./data-access-error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** `CredentialsRepository` over Supabase: one read of `users` with the service role. */
export class SupabaseCredentialsRepository implements CredentialsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByEmail(email: string): Promise<StoredCredentials | null> {
    const { data, error } = await this.client
      .from("users")
      .select("id, password_hash, email_confirmed_at")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      throw new DataAccessError("find_credentials", error.code);
    }

    if (data === null) {
      return null;
    }

    const row: unknown = data;

    if (
      !isRecord(row) ||
      typeof row.id !== "string" ||
      typeof row.password_hash !== "string" ||
      (row.email_confirmed_at !== null && typeof row.email_confirmed_at !== "string")
    ) {
      throw new DataAccessError("find_credentials", "UNEXPECTED_RESULT");
    }

    return {
      userId: row.id,
      passwordHash: row.password_hash,
      emailConfirmed: row.email_confirmed_at !== null,
    };
  }
}
