-- ===========================================================================
-- CALLPRO CRM - local verification shim (NOT part of the deployment path)
--
-- The migrations target a real Supabase project, which already provides the
-- `auth` schema, `auth.users`, `auth.uid()`, the `anon`/`authenticated`/
-- `service_role` roles and default table grants. A plain PostgreSQL server has
-- none of that, so this file recreates just enough of the Supabase surface to
-- execute 001 -> 002 -> 003 unmodified and then exercise RLS for real.
--
-- This is a test fixture. Never run it against a Supabase project.
-- ===========================================================================

create schema if not exists extensions;
create schema if not exists auth;

-- Supabase's built-in roles. `service_role` bypasses RLS, as it does upstream.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase grants table privileges through default privileges for the migration
-- role, which is why the migrations themselves never GRANT on tables. Mirror it.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth.users: only the columns public.handle_new_user() actually reads.
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- auth.uid(): the caller's user id taken from the JWT claims, exactly as
-- Supabase resolves it from the request's `request.jwt.claims` setting.
-- Returns NULL for anon / server contexts, which the guard triggers rely on.
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
           coalesce(
             nullif(current_setting('request.jwt.claim.sub', true), ''),
             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           ),
           ''
         )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
