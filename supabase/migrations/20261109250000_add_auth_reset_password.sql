-- 0010-auth-reset-password: atomic "reset password" function.
--
-- Same security model as 0004: called only by the API (service role) through RPC;
-- `execute` is revoked from public, anon and authenticated.
--
-- Rollback (run manually; it does not restore any previous password):
--   drop function if exists public.auth_reset_password(text, text);

-- Consumes a `password_reset` token and changes the password, in one transaction:
--   1. marks the token used (the single `update ... where used_at is null` is what makes it
--      single-use under concurrency: a second call waits for the first, re-checks the `where`
--      after the first commits, finds the token used and returns no row);
--   2. stores the new password hash;
--   3. invalidates the user's other unused `password_reset` tokens;
--   4. revokes every active session of the user (the password changed, so any existing
--      session may be in the wrong hands).
-- Returns the user's id, first name and e-mail, or no row when the token is unknown, expired,
-- already used or of another type (the caller cannot tell which).
create or replace function public.auth_reset_password(
  p_token_hash text,
  p_password_hash text
)
returns table (user_id uuid, first_name text, email text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user_id uuid;
  v_first_name text;
  v_email text;
begin
  update public.auth_tokens t
     set used_at = now()
   where t.token_hash = p_token_hash
     and t.type = 'password_reset'
     and t.used_at is null
     and t.expires_at > now()
  returning t.user_id into v_user_id;

  if v_user_id is null then
    return;
  end if;

  update public.users u
     set password_hash = p_password_hash
   where u.id = v_user_id
  returning u.first_name, u.email into v_first_name, v_email;

  update public.auth_tokens t
     set used_at = now()
   where t.user_id = v_user_id
     and t.type = 'password_reset'
     and t.used_at is null;

  update public.sessions s
     set revoked_at = now()
   where s.user_id = v_user_id
     and s.revoked_at is null;

  return query select v_user_id, v_first_name, v_email;
end;
$$;

revoke all on function public.auth_reset_password(text, text)
  from public, anon, authenticated;
grant execute on function public.auth_reset_password(text, text)
  to service_role;
