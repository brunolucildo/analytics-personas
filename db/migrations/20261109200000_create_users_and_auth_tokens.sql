-- 0004-auth-sign-up: users, auth_tokens and the transactional sign-up function.
--
-- Security model: these tables hold password hashes and token hashes. The schema
-- is owned by `rondo_migrator` (DDL); the API connects as `rondo_app`, which gets
-- DML on the tables and `execute` on the SQL functions, and nothing else. There
-- is no PostgREST, no RLS and no `anon`/`authenticated`/`service_role`.
--
-- Rollback (run manually, in this order; it deletes every account):
--   drop function if exists public.auth_sign_up(text, text, text, text, text, timestamptz);
--   drop table if exists public.auth_tokens;
--   drop table if exists public.users;
--   drop function if exists public.set_updated_at();

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  -- Stored already normalized (trim + lower case) by the API; the check keeps it that way.
  email text not null check (char_length(email) <= 254 and email = lower(btrim(email))),
  password_hash text not null,
  -- Null means the e-mail address was not confirmed yet.
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_key unique (email)
);

create table if not exists public.auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null check (type in ('email_confirmation', 'password_reset')),
  -- SHA-256 (hex) of the opaque token sent to the user; the token itself is never stored.
  token_hash text not null,
  expires_at timestamptz not null,
  -- Null means the token can still be used.
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_tokens_token_hash_key unique (token_hash)
);

-- Lookups and clean-up by owner and kind (resend confirmation, forgot password).
create index if not exists auth_tokens_user_id_type_idx on public.auth_tokens (user_id, type);

grant select, insert, update, delete on table public.users to rondo_app;
grant select, insert, update, delete on table public.auth_tokens to rondo_app;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Creates the unconfirmed user and its e-mail confirmation token in one transaction.
-- Returns the new user id, or null when the e-mail is already registered. The
-- `on conflict` clause makes simultaneous sign-ups with the same e-mail safe:
-- one gets the id, the others get null, and nobody gets an exception.
create or replace function public.auth_sign_up(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_password_hash text,
  p_token_hash text,
  p_token_expires_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  insert into public.users (first_name, last_name, email, password_hash)
  values (p_first_name, p_last_name, p_email, p_password_hash)
  on conflict (email) do nothing
  returning id into v_user_id;

  if v_user_id is null then
    return null;
  end if;

  insert into public.auth_tokens (user_id, type, token_hash, expires_at)
  values (v_user_id, 'email_confirmation', p_token_hash, p_token_expires_at);

  return v_user_id;
end;
$$;

revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to rondo_app;

revoke all on function public.auth_sign_up(text, text, text, text, text, timestamptz)
  from public;
grant execute on function public.auth_sign_up(text, text, text, text, text, timestamptz)
  to rondo_app;
