-- 0009-auth-forgot-password: atomic "request a password reset" function.
--
-- Same security model as 0004: called by the API with `rondo_app`; `execute` is
-- revoked from public and granted to `rondo_app` only.
--
-- Rollback (run manually):
--   drop function if exists public.auth_request_password_reset(text, text, timestamptz);

-- For a CONFIRMED account with the given (already normalized) e-mail: invalidates
-- every unused `password_reset` token of the user and stores the new one, in one
-- transaction. Returns the user's first name, or null when nothing was done
-- (unknown e-mail or unconfirmed account). The user row is locked (`for update`),
-- so simultaneous requests are serialized and the user never ends up with two
-- valid reset tokens.
create or replace function public.auth_request_password_reset(
  p_email text,
  p_token_hash text,
  p_token_expires_at timestamptz
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_first_name text;
begin
  select u.id, u.first_name
    into v_user_id, v_first_name
    from public.users u
   where u.email = p_email
     and u.email_confirmed_at is not null
     for update;

  if v_user_id is null then
    return null;
  end if;

  update public.auth_tokens
     set used_at = now()
   where user_id = v_user_id
     and type = 'password_reset'
     and used_at is null;

  insert into public.auth_tokens (user_id, type, token_hash, expires_at)
  values (v_user_id, 'password_reset', p_token_hash, p_token_expires_at);

  return v_first_name;
end;
$$;

revoke all on function public.auth_request_password_reset(text, text, timestamptz)
  from public;
grant execute on function public.auth_request_password_reset(text, text, timestamptz)
  to rondo_app;
