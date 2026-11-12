-- 0005-auth-sessions-and-route-guard: sessions and the transactional issue function.
--
-- A session is the server side record behind the JWT `sid` claim. The API checks
-- it on every authenticated request, so revoking a row ends the session at once.
-- At most one session per user is active (revoked_at is null): enforced by a
-- partial unique index, and the issue function revokes the previous one first.
--
-- Security model (same as users and auth_tokens, see the 0004 migration):
--   * `sessions` belongs to `rondo_migrator`; the API connects as `rondo_app`;
--   * `rondo_app` gets DML on the table and `execute` on the function;
--   * there is no RLS, PostgREST or `anon`/`authenticated`/`service_role`.
--
-- Rollback (run manually, in this order; it signs everybody out):
--   drop function if exists public.auth_issue_session(uuid, timestamptz);
--   drop table if exists public.sessions;

create table if not exists public.sessions (
  -- The `sid` claim of the access token.
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Null means the session is active.
  revoked_at timestamptz
);

-- The database itself refuses a second active session for the same user.
create unique index if not exists sessions_user_id_active_key
  on public.sessions (user_id)
  where revoked_at is null;

grant select, insert, update, delete on table public.sessions to rondo_app;

-- Starts a new session for the user and revokes the active one, in one transaction.
-- Returns the new session id with the user's public fields, or no row when the
-- user does not exist. The user row is locked first, so two simultaneous calls for
-- the same user run one after the other (the loser revokes the winner's session);
-- the partial unique index is the final guarantee that two are never active.
create or replace function public.auth_issue_session(
  p_user_id uuid,
  p_expires_at timestamptz
)
returns table (session_id uuid, first_name text, last_name text, email text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user public.users%rowtype;
  v_session_id uuid;
begin
  select * into v_user from public.users u where u.id = p_user_id for no key update;

  if not found then
    return;
  end if;

  update public.sessions s
    set revoked_at = now()
    where s.user_id = p_user_id and s.revoked_at is null;

  insert into public.sessions (user_id, expires_at)
  values (p_user_id, p_expires_at)
  returning id into v_session_id;

  return query select v_session_id, v_user.first_name, v_user.last_name, v_user.email;
end;
$$;

revoke all on function public.auth_issue_session(uuid, timestamptz)
  from public;
grant execute on function public.auth_issue_session(uuid, timestamptz)
  to rondo_app;
