-- ===========================================================================
-- CALLPRO CRM - 001: schema
-- Run order: 001 -> 002 -> 003
-- Target: Supabase Postgres (has auth schema, auth.uid(), auth.users)
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum (
    'New', 'Not Answered', 'Interested', 'Not Interested',
    'Callback', 'Follow-up', 'Converted', 'Invalid'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.follow_up_status as enum ('pending', 'done', 'missed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_status as enum ('present', 'absent', 'half-day', 'leave');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. `role` here is the ONLY authority for RBAC.
-- A profile is created automatically by the auth.users trigger below, always
-- defaulting to 'employee' - an attacker signing up can never self-assign admin.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  phone       text,
  role        public.user_role not null default 'employee',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role) where role = 'employee';

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) > 0),
  phone              text not null check (length(trim(phone)) > 0),
  email              text,
  company            text,
  city               text,
  source             text not null default 'Manual',
  status             public.lead_status not null default 'New',
  assigned_to        uuid references public.profiles (id) on delete set null,
  notes              text,
  last_contacted_at  timestamptz,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- De-duplication key for CSV import: one row per normalised phone number.
create unique index if not exists leads_phone_uniq on public.leads (phone);
create index if not exists leads_assigned_idx on public.leads (assigned_to);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_search_idx on public.leads using gin (
  to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(phone, ''))
);

-- ---------------------------------------------------------------------------
-- call_logs: append-only call history written by the employee who called.
-- ---------------------------------------------------------------------------
create table if not exists public.call_logs (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.leads (id) on delete cascade,
  employee_id       uuid not null references public.profiles (id) on delete cascade,
  outcome           text not null default 'Answered',
  note              text,
  duration_seconds  integer not null default 0 check (duration_seconds >= 0 and duration_seconds <= 86400),
  called_at         timestamptz not null default now()
);

create index if not exists call_logs_lead_idx on public.call_logs (lead_id, called_at desc);
create index if not exists call_logs_employee_idx on public.call_logs (employee_id, called_at desc);
create index if not exists call_logs_called_idx on public.call_logs (called_at desc);

-- ---------------------------------------------------------------------------
-- follow_ups: reminder queue surfaced to the employee who owns the lead.
-- ---------------------------------------------------------------------------
create table if not exists public.follow_ups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  assigned_to   uuid references public.profiles (id) on delete set null,
  due_at        timestamptz not null,
  note          text,
  status        public.follow_up_status not null default 'pending',
  completed_at  timestamptz,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists follow_ups_assigned_idx on public.follow_ups (assigned_to, status, due_at);
create index if not exists follow_ups_lead_idx on public.follow_ups (lead_id);
create index if not exists follow_ups_due_idx on public.follow_ups (due_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- attendance: one row per employee per working day.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  work_date    date not null default current_date,
  check_in     timestamptz,
  check_out    timestamptz,
  status       public.attendance_status not null default 'present',
  notes        text,
  created_at   timestamptz not null default now(),
  unique (employee_id, work_date)
);

create index if not exists attendance_date_idx on public.attendance (work_date desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile for every new auth user.
-- SECURITY: role is hard-coded to 'employee'. Any role value supplied in
-- user metadata during sign-up is ignored, so nobody can self-promote.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
