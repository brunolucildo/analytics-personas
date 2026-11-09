import { ensureLocalSupabaseEnv } from "../../../../scripts/lib/supabase-env";

/**
 * Integration tests run against the local Supabase stack. Unless the Supabase
 * variables are already in the environment, they are read from
 * `supabase status -o env` and exported before the test workers start.
 */
export default function setup(): void {
  ensureLocalSupabaseEnv();
}
