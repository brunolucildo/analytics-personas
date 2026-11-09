import type { SupabaseClient } from "@supabase/supabase-js";
import { uniqueEmail } from "./supabase";

export interface SeededUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Inserts a confirmed user straight into the database (service role), so session
 * tests need no sign-up or sign-in. The password hash is a placeholder: nothing
 * in these tests verifies a password. Remove it with `deleteUsersByEmail`.
 */
export async function seedConfirmedUser(
  admin: SupabaseClient,
  label: string,
  names: { firstName: string; lastName: string } = { firstName: "Ana", lastName: "Silva" },
): Promise<SeededUser> {
  const email = uniqueEmail(label);
  const { data, error } = await admin
    .from("users")
    .insert({
      first_name: names.firstName,
      last_name: names.lastName,
      email,
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder",
      email_confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      "Could not seed a user. Run `bun run infra:up` and `bun run db:migrate` from the repository root.",
    );
  }

  return { id: data.id as string, ...names, email };
}

/** Sessions of a user, newest first, as stored (snake_case columns). */
export async function sessionsOf(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return data ?? [];
}
