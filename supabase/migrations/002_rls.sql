-- ===========================================================================
-- CALLPRO CRM - 002: row level security
--
-- This file is the authoritative access-control layer. Every table is default
-- DENY: RLS is enabled and no permissive policy exists for anonymous users.
-- The frontend hiding a button is irrelevant - a crafted REST/PostgREST call
-- carrying a valid employee JWT still cannot read or write another employee's
-- rows, because the database refuses.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Role helpers.
--
-- SECURITY DEFINER is required: app_role() reads public.profiles while a policy
-- on public.profiles is being evaluated, which would otherwise recurse.
-- search_path is pinned to prevent function-hijacking.
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'admin' and p.active from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- True when the caller is an active admin, or owns this lead.
create or replace function public.can_access_lead(p_lead uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead
      and (public.is_admin() or l.assigned_to = auth.uid())
  );
$$;

revoke all on function public.app_role() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.can_access_lead(uuid) from public;
grant execute on function public.app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (default deny)
-- ---------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.leads       enable row level security;
alter table public.call_logs   enable row level security;
alter table public.follow_ups  enable row level security;
alter table public.attendance  enable row level security;

-- Force RLS for table owners too, so no accidental bypass via ownership.
alter table public.profiles    force row level security;
alter table public.leads       force row level security;
alter table public.call_logs   force row level security;
alter table public.follow_ups  force row level security;
alter table public.attendance  force row level security;

revoke all on public.profiles   from anon;
revoke all on public.leads      from anon;
revoke all on public.call_logs  from anon;
revoke all on public.follow_ups from anon;
revoke all on public.attendance from anon;

-- ---------------------------------------------------------------------------
-- profiles
--   read  : own row, or admin reads everyone
--   write : own row (limited columns, see guard trigger), admin edits anyone
--   insert/delete: admin only, and only through the service role API
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- leads
--   employee : SELECT/UPDATE only where assigned_to = auth.uid()
--              INSERT/DELETE denied entirely
--   admin    : full access
-- ---------------------------------------------------------------------------
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (public.is_admin() or assigned_to = auth.uid());

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (public.is_admin());

-- WITH CHECK re-tests ownership on the NEW row: an employee cannot move a lead
-- to somebody else (and therefore cannot shed or gain leads via UPDATE).
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using (public.is_admin() or assigned_to = auth.uid())
  with check (public.is_admin() or assigned_to = auth.uid());

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- call_logs - append-only history
--   employee : reads own calls; may insert only against a lead they own and
--              only under their own employee_id
--   admin    : full access
-- ---------------------------------------------------------------------------
drop policy if exists call_logs_select on public.call_logs;
create policy call_logs_select on public.call_logs
  for select to authenticated
  using (public.is_admin() or employee_id = auth.uid());

drop policy if exists call_logs_insert on public.call_logs;
create policy call_logs_insert on public.call_logs
  for insert to authenticated
  with check (
    public.is_admin()
    or (employee_id = auth.uid() and public.can_access_lead(lead_id))
  );

drop policy if exists call_logs_update_admin on public.call_logs;
create policy call_logs_update_admin on public.call_logs
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists call_logs_delete_admin on public.call_logs;
create policy call_logs_delete_admin on public.call_logs
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- follow_ups
-- ---------------------------------------------------------------------------
drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups
  for select to authenticated
  using (public.is_admin() or assigned_to = auth.uid());

drop policy if exists follow_ups_insert on public.follow_ups;
create policy follow_ups_insert on public.follow_ups
  for insert to authenticated
  with check (
    public.is_admin()
    or (assigned_to = auth.uid() and public.can_access_lead(lead_id))
  );

drop policy if exists follow_ups_update on public.follow_ups;
create policy follow_ups_update on public.follow_ups
  for update to authenticated
  using (public.is_admin() or assigned_to = auth.uid())
  with check (public.is_admin() or assigned_to = auth.uid());

drop policy if exists follow_ups_delete_admin on public.follow_ups;
create policy follow_ups_delete_admin on public.follow_ups
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (public.is_admin() or employee_id = auth.uid());

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (public.is_admin() or employee_id = auth.uid());

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using (public.is_admin() or employee_id = auth.uid())
  with check (public.is_admin() or employee_id = auth.uid());

drop policy if exists attendance_delete_admin on public.attendance;
create policy attendance_delete_admin on public.attendance
  for delete to authenticated
  using (public.is_admin());

-- ===========================================================================
-- Escalation guards (triggers).
--
-- RLS decides which ROWS are visible; these triggers decide which COLUMNS may
-- change. Together they block privilege escalation and data-ownership tampering
-- even from a valid-but-malicious authenticated session.
--
-- `auth.uid() is null` means the change comes from a trusted server context
-- (service role / migrations), which is allowed through.
-- ===========================================================================

-- 1. Nobody except an admin may change role, active flag, email or id.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.id <> old.id then
    raise exception 'profiles.id is immutable' using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    raise exception 'Only an admin can change a role' using errcode = '42501';
  end if;
  if new.active is distinct from old.active then
    raise exception 'Only an admin can change account status' using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception 'email cannot be changed here' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 2. An employee may update the pipeline fields of their own lead but may never
--    hand the lead to someone else, or rewrite provenance (created_by).
create or replace function public.guard_lead_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only an admin can reassign a lead' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before update on public.leads
  for each row execute function public.guard_lead_update();

-- 3. Attendance rows must stay attached to the employee who created them.
create or replace function public.guard_attendance_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id then
    raise exception 'employee_id is immutable' using errcode = '42501';
  end if;
  if new.work_date is distinct from old.work_date then
    raise exception 'work_date is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_guard on public.attendance;
create trigger attendance_guard before update on public.attendance
  for each row execute function public.guard_attendance_update();

-- 4. A follow-up may be completed by its owner but not silently re-pointed at a
--    different employee or lead.
create or replace function public.guard_follow_up_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only an admin can reassign a follow-up' using errcode = '42501';
  end if;
  if new.lead_id is distinct from old.lead_id then
    raise exception 'lead_id is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists follow_ups_guard on public.follow_ups;
create trigger follow_ups_guard before update on public.follow_ups
  for each row execute function public.guard_follow_up_update();
