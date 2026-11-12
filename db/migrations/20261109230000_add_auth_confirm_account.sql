-- 0006-auth-confirm-account: atomic "confirm account" and "resend confirmation" functions.
--
-- Same security model as 0004: called by the API with `rondo_app`; `execute` is
-- revoked from public and granted to `rondo_app` only.
--
-- Rollback (run manually):
--   drop function if exists public.auth_confirm_account(text);
--   drop function if exists public.auth_resend_confirmation(text, text, timestamptz);

-- Consumes an `email_confirmation` token and confirms the user's e-mail, in one
-- transaction. Returns the user id, or null when the token is unknown, expired,
-- already used or of another type (the caller cannot tell which). The single
-- `update ... where used_at is null` is what makes the token single-use under
-- concurrency: a second call waits for the first, re-checks the `where` after
-- the first commits, finds the token used and returns null.
create or replace function public.auth_confirm_account(p_token_hash text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  update public.auth_tokens t
     set used_at = now()
   where t.token_hash = p_token_hash
     and t.type = 'email_confirmation'
     and t.used_at is null
     and t.expires_at > now()
  returning t.user_id into v_user_id;

  if v_user_id is null then
    return null;
  end if;

  update public.users u
     set email_confirmed_at = coalesce(u.email_confirmed_at, now())
   where u.id = v_user_id;

  return v_user_id;
end;
$$;

-- For an UNCONFIRMED account with the given (already normalized) e-mail:
-- invalidates every unused `email_confirmation` token of the user and stores the
-- new one, in one transaction. Returns the user's first name, or null when
-- nothing was done (unknown e-mail or account already confirmed). The user row is
-- locked (`for update`), so simultaneous requests are serialized and the user
-- never ends up with two valid confirmation tokens.
create or replace function public.auth_resend_confirmation(
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
     and u.email_confirmed_at is null
     for update;

  if v_user_id is null then
    return null;
  end if;

  update public.auth_tokens
     set used_at = now()
   where user_id = v_user_id
     and type = 'email_confirmation'
     and used_at is null;

  insert into public.auth_tokens (user_id, type, token_hash, expires_at)
  values (v_user_id, 'email_confirmation', p_token_hash, p_token_expires_at);

  return v_first_name;
end;
$$;

revoke all on function public.auth_confirm_account(text)
  from public;
grant execute on function public.auth_confirm_account(text)
  to rondo_app;

revoke all on function public.auth_resend_confirmation(text, text, timestamptz)
  from public;
grant execute on function public.auth_resend_confirmation(text, text, timestamptz)
  to rondo_app;
