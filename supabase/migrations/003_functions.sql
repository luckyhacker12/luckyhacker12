-- ===========================================================================
-- CALLPRO CRM - 003: aggregate functions
--
-- Dashboard totals are computed inside the database so the API never has to
-- pull every row to count them. Both functions are SECURITY DEFINER (needed to
-- aggregate across employees) but re-check the caller's role themselves, so an
-- employee calling them directly through PostgREST gets a 42501 error.
-- ===========================================================================

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_leads',        (select count(*) from public.leads),
    'unassigned_leads',   (select count(*) from public.leads where assigned_to is null),
    'converted_leads',    (select count(*) from public.leads where status = 'Converted'),
    'total_employees',    (select count(*) from public.profiles where role = 'employee'),
    'active_employees',   (select count(*) from public.profiles where role = 'employee' and active),
    'total_calls',        (select count(*) from public.call_logs),
    'calls_today',        (select count(*) from public.call_logs where called_at >= date_trunc('day', now())),
    'calls_week',         (select count(*) from public.call_logs where called_at >= date_trunc('week', now())),
    'pending_followups',  (select count(*) from public.follow_ups where status = 'pending'),
    'overdue_followups',  (select count(*) from public.follow_ups where status = 'pending' and due_at < now()),
    'due_today_followups',(select count(*) from public.follow_ups
                            where status = 'pending' and due_at >= date_trunc('day', now())
                              and due_at < date_trunc('day', now()) + interval '1 day'),
    'present_today',      (select count(*) from public.attendance
                            where work_date = current_date and status = 'present'),
    'status_counts',      (select coalesce(jsonb_object_agg(s.status, s.c), '{}'::jsonb)
                             from (select status::text as status, count(*) as c
                                     from public.leads group by status) s),
    'employees',          (select coalesce(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb)
                             from (
                               select p.id,
                                      p.full_name,
                                      p.email,
                                      p.active,
                                      (select count(*) from public.leads l where l.assigned_to = p.id) as leads,
                                      (select count(*) from public.leads l where l.assigned_to = p.id and l.status = 'Converted') as converted,
                                      (select count(*) from public.call_logs c where c.employee_id = p.id) as calls_total,
                                      (select count(*) from public.call_logs c
                                        where c.employee_id = p.id and c.called_at >= date_trunc('day', now())) as calls_today,
                                      (select count(*) from public.follow_ups f
                                        where f.assigned_to = p.id and f.status = 'pending') as pending_followups,
                                      (select count(*) from public.follow_ups f
                                        where f.assigned_to = p.id and f.status = 'pending' and f.due_at < now()) as overdue_followups,
                                      (select max(c.called_at) from public.call_logs c where c.employee_id = p.id) as last_call_at
                               from public.profiles p
                               where p.role = 'employee'
                               order by p.full_name
                             ) e)
  ) into result;

  return result;
end;
$$;

create or replace function public.my_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'my_leads',         (select count(*) from public.leads where assigned_to = auth.uid()),
    'new_leads',        (select count(*) from public.leads where assigned_to = auth.uid() and status = 'New'),
    'interested',       (select count(*) from public.leads where assigned_to = auth.uid() and status = 'Interested'),
    'converted',        (select count(*) from public.leads where assigned_to = auth.uid() and status = 'Converted'),
    'calls_today',      (select count(*) from public.call_logs
                          where employee_id = auth.uid() and called_at >= date_trunc('day', now())),
    'calls_total',      (select count(*) from public.call_logs where employee_id = auth.uid()),
    'due_today',        (select count(*) from public.follow_ups
                          where assigned_to = auth.uid() and status = 'pending'
                            and due_at < date_trunc('day', now()) + interval '1 day'),
    'overdue',          (select count(*) from public.follow_ups
                          where assigned_to = auth.uid() and status = 'pending' and due_at < now()),
    'status_counts',    (select coalesce(jsonb_object_agg(s.status, s.c), '{}'::jsonb)
                           from (select status::text as status, count(*) as c
                                   from public.leads where assigned_to = auth.uid()
                                  group by status) s)
  ) into result;

  return result;
end;
$$;

-- Round-robin lead distribution, executed with the admin's own identity.
-- Kept in SQL so the assignment is atomic and cannot race between two admins.
create or replace function public.assign_leads_round_robin(p_lead_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee uuid;
  v_employee_ids uuid[];
  v_pool integer;
  v_idx integer := 0;
  v_lead uuid;
  v_assigned integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select coalesce(array_agg(p.id order by p.full_name), '{}')
    into v_employee_ids
    from public.profiles p
   where p.role = 'employee' and p.active;

  v_pool := coalesce(array_length(v_employee_ids, 1), 0);
  if v_pool = 0 then
    raise exception 'No active employees available for assignment' using errcode = 'P0001';
  end if;

  foreach v_lead in array p_lead_ids loop
    v_employee := v_employee_ids[(v_idx % v_pool) + 1];
    v_idx := v_idx + 1;

    update public.leads
       set assigned_to = v_employee
     where id = v_lead;
    if found then
      v_assigned := v_assigned + 1;
    end if;
  end loop;

  return jsonb_build_object('assigned', v_assigned, 'employees_used', v_pool);
end;
$$;

revoke all on function public.admin_dashboard() from public;
revoke all on function public.my_dashboard() from public;
revoke all on function public.assign_leads_round_robin(uuid[]) from public;

grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.my_dashboard() to authenticated;
grant execute on function public.assign_leads_round_robin(uuid[]) to authenticated;
