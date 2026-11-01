-- ===========================================================================
-- CALLPRO CRM - RLS / authorization assertions (local only)
--
-- Every assertion raises an exception when the real behaviour differs from the
-- documented rule, so the whole file fails loudly. Run after 00/10 + migrations.
-- Any assertion that silently "passes" because a row was invisible must also be
-- re-checked from a privileged context, otherwise RLS could be hiding a bug.
-- ===========================================================================

create schema if not exists tests;

create or replace function tests.eq(p_label text, p_actual anyelement, p_expected anyelement)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (expected %, got %)', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok   %', p_label;
end;
$$;

-- Runs a statement that must be rejected. A row that is merely filtered away by
-- RLS is NOT an error, so use this only for guards/RLS WITH CHECK violations.
create or replace function tests.denied(p_label text, p_sql text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege or sqlstate '42501' then
      raise notice 'ok   % (blocked)', p_label;
      return;
  end;
  raise exception 'FAIL: % was allowed but must be denied', p_label;
end;
$$;

revoke all on all functions in schema tests from public;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. ADMIN SESSION: sees everything, dashboards aggregate correctly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  select tests.eq('admin: auth.uid() resolves from JWT claims',
                  auth.uid() = '11111111-1111-1111-1111-111111111111', true);
  select tests.eq('admin: app_role() is admin', public.app_role(), 'admin'::public.user_role);
  select tests.eq('admin: sees all 4 leads', (select count(*)::int from public.leads), 4);
  select tests.eq('admin: sees all 3 profiles', (select count(*)::int from public.profiles), 3);
  select tests.eq('admin: sees both employees'' call logs', (select count(*)::int from public.call_logs), 2);
  select tests.eq('admin: sees all follow-ups', (select count(*)::int from public.follow_ups), 3);
  select tests.eq('admin: sees all attendance rows', (select count(*)::int from public.attendance), 1);

  select tests.eq('admin_dashboard: total_leads', (public.admin_dashboard()->>'total_leads')::int, 4);
  select tests.eq('admin_dashboard: unassigned_leads', (public.admin_dashboard()->>'unassigned_leads')::int, 1);
  select tests.eq('admin_dashboard: converted_leads', (public.admin_dashboard()->>'converted_leads')::int, 1);
  select tests.eq('admin_dashboard: total_employees', (public.admin_dashboard()->>'total_employees')::int, 2);
  select tests.eq('admin_dashboard: active_employees', (public.admin_dashboard()->>'active_employees')::int, 2);
  select tests.eq('admin_dashboard: total_calls', (public.admin_dashboard()->>'total_calls')::int, 2);
  select tests.eq('admin_dashboard: calls_today', (public.admin_dashboard()->>'calls_today')::int, 2);
  select tests.eq('admin_dashboard: pending_followups', (public.admin_dashboard()->>'pending_followups')::int, 2);
  select tests.eq('admin_dashboard: overdue_followups', (public.admin_dashboard()->>'overdue_followups')::int, 1);
  select tests.eq('admin_dashboard: present_today', (public.admin_dashboard()->>'present_today')::int, 1);
  select tests.eq('admin_dashboard: status_counts.Converted',
                  public.admin_dashboard()->'status_counts'->>'Converted', '1');
  select tests.eq('admin_dashboard: per-employee lead count',
                  (select e->>'leads' from jsonb_array_elements(public.admin_dashboard()->'employees') e
                    where e->>'email' = 'bob@example.test'), '2');
  select tests.eq('admin_dashboard: bootstrap profile role is employee, not admin',
                  (select count(*)::int from public.profiles
                    where id = '22222222-2222-2222-2222-222222222222' and role = 'employee'), 1);
commit;

-- ---------------------------------------------------------------------------
-- 2. EMPLOYEE SESSION (Bob): only his own rows, no escalation possible
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

  select tests.eq('employee: app_role() is employee', public.app_role(), 'employee'::public.user_role);

  -- Read scoping
  select tests.eq('employee: sees only own 2 leads', (select count(*)::int from public.leads), 2);
  select tests.eq('employee: cannot read another employee''s lead',
                  (select count(*)::int from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0);
  select tests.eq('employee: cannot read the unassigned lead',
                  (select count(*)::int from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000003'), 0);
  select tests.eq('employee: sees only own profile row', (select count(*)::int from public.profiles), 1);
  select tests.eq('employee: cannot read another employee''s call logs',
                  (select count(*)::int from public.call_logs), 1);
  select tests.eq('employee: cannot read another employee''s follow-ups',
                  (select count(*)::int from public.follow_ups), 2);
  select tests.eq('employee: cannot read another employee''s attendance',
                  (select count(*)::int from public.attendance), 1);

  -- my_dashboard is employee-scoped
  select tests.eq('my_dashboard: my_leads', (public.my_dashboard()->>'my_leads')::int, 2);
  select tests.eq('my_dashboard: new_leads', (public.my_dashboard()->>'new_leads')::int, 1);
  select tests.eq('my_dashboard: converted', (public.my_dashboard()->>'converted')::int, 1);
  select tests.eq('my_dashboard: calls_total', (public.my_dashboard()->>'calls_total')::int, 1);
  select tests.eq('my_dashboard: due_today', (public.my_dashboard()->>'due_today')::int, 2);
  select tests.eq('my_dashboard: overdue', (public.my_dashboard()->>'overdue')::int, 1);
  select tests.denied('my_dashboard: employee cannot call admin_dashboard',
                      'select public.admin_dashboard()');

  -- Legitimate employee work still allowed
  update public.leads set status = 'Interested'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select tests.eq('employee: can update own lead status',
                  (select status::text from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'Interested');

  insert into public.call_logs (lead_id, employee_id, outcome, note)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222', 'Callback', 'Asked for a callback');
  select tests.eq('employee: can log a call on own lead',
                  (select count(*)::int from public.call_logs), 2);

  -- Escalation + tampering attempts must fail with an error, not silently no-op
  select tests.denied('employee: cannot reassign a lead to a colleague',
    $q$update public.leads set assigned_to = '33333333-3333-3333-3333-333333333333'
        where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$);
  select tests.denied('employee: cannot unassign own lead',
    $q$update public.leads set assigned_to = null
        where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$);
  select tests.denied('employee: cannot promote themself to admin',
    $q$update public.profiles set role = 'admin'
        where id = '22222222-2222-2222-2222-222222222222'$q$);
  select tests.denied('employee: cannot change another profile',
    $q$update public.profiles set full_name = 'Hacked'
        where id = '33333333-3333-3333-3333-333333333333'$q$);
  select tests.denied('employee: cannot insert a lead',
    $q$insert into public.leads (name, phone) values ('Sneaky', '+15559999999')$q$);
  select tests.denied('employee: cannot log a call against a colleague''s lead',
    $q$insert into public.call_logs (lead_id, employee_id, outcome)
       values ('aaaaaaaa-0000-0000-0000-000000000002',
               '22222222-2222-2222-2222-222222222222', 'Answered')$q$);
  select tests.denied('employee: cannot log a call under a colleague''s identity',
    $q$insert into public.call_logs (lead_id, employee_id, outcome)
       values ('aaaaaaaa-0000-0000-0000-000000000001',
               '33333333-3333-3333-3333-333333333333', 'Answered')$q$);
  select tests.denied('employee: cannot create a follow-up for a colleague',
    $q$insert into public.follow_ups (lead_id, assigned_to, due_at)
       values ('aaaaaaaa-0000-0000-0000-000000000002',
               '33333333-3333-3333-3333-333333333333', now() + interval '1 day')$q$);
  select tests.denied('employee: cannot run round-robin assignment',
    $q$select public.assign_leads_round_robin(array['aaaaaaaa-0000-0000-0000-000000000003']::uuid[])$q$);
  select tests.denied('employee: cannot create a user profile row for someone else',
    $q$insert into public.profiles (id, email, full_name, role)
       values ('99999999-9999-9999-9999-999999999999', 'x@example.test', 'X', 'admin')$q$);

  -- Delete is filtered to zero rows for employees (no policy grants it)
  delete from public.leads where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select tests.eq('employee: delete affects no rows', (select count(*)::int from public.leads), 2);
  delete from public.call_logs where lead_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select tests.eq('employee: cannot delete call logs', (select count(*)::int from public.call_logs), 2);
commit;

-- ---------------------------------------------------------------------------
-- 3. Cross-check the blocked writes from a privileged context, so an
--    "invisible row" cannot masquerade as a blocked write.
-- ---------------------------------------------------------------------------
begin;
  select tests.eq('verify: colleague''s lead was not modified',
                  (select status::text from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'Interested');
  select tests.eq('verify: round-robin did not assign the unassigned lead',
                  (select count(*)::int from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000003' and assigned_to is null), 1);
  select tests.eq('verify: no self-promotion happened',
                  (select role::text from public.profiles
                    where id = '22222222-2222-2222-2222-222222222222'), 'employee');
  select tests.eq('verify: no extra leads were inserted',
                  (select count(*)::int from public.leads), 4);
  select tests.eq('verify: no cross-employee call log was inserted',
                  (select count(*)::int from public.call_logs
                    where employee_id <> '22222222-2222-2222-2222-222222222222'
                      and id not in (select id from public.call_logs
                                      where lead_id = 'aaaaaaaa-0000-0000-0000-000000000002'
                                        and employee_id = '33333333-3333-3333-3333-333333333333')), 0);
  select tests.eq('verify: extra profile was not created',
                  (select count(*)::int from public.profiles), 3);
commit;

-- ---------------------------------------------------------------------------
-- 4. ANON: no table access at all
-- ---------------------------------------------------------------------------
begin;
  set local role anon;
  select tests.denied('anon: cannot read leads', $q$select count(*) from public.leads$q$);
  select tests.eq('anon: auth.uid() is null', auth.uid() is null, true);
  select tests.eq('anon: app_role() is null', public.app_role() is null, true);
commit;

-- ---------------------------------------------------------------------------
-- 5. ADMIN writes that must work: reassignment + round-robin distribution
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

  update public.leads set assigned_to = '33333333-3333-3333-3333-333333333333'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select tests.eq('admin: can reassign a lead',
                  (select assigned_to from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
                  '33333333-3333-3333-3333-333333333333'::uuid);

  select tests.eq('round_robin: distributes the unassigned lead',
                  (public.assign_leads_round_robin(
                     array['aaaaaaaa-0000-0000-0000-000000000003']::uuid[])->>'assigned')::int, 1);
  select tests.eq('round_robin: reported pool size',
                  (public.assign_leads_round_robin(
                     array['aaaaaaaa-0000-0000-0000-000000000003']::uuid[])->>'employees_used')::int, 2);
  select tests.eq('round_robin: lead is no longer unassigned',
                  (select count(*)::int from public.leads
                    where id = 'aaaaaaaa-0000-0000-0000-000000000003' and assigned_to is null), 0);
commit;

-- ---------------------------------------------------------------------------
-- 6. Sign-up cannot self-assign admin: role from user metadata is ignored
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444444444', 'eve@example.test',
   '{"full_name":"Eve Sly","role":"admin"}');

select tests.eq('signup: metadata role is ignored',
                (select role::text from public.profiles
                  where id = '44444444-4444-4444-4444-444444444444'), 'employee');
select tests.eq('signup: full_name is taken from metadata',
                (select full_name from public.profiles
                  where id = '44444444-4444-4444-4444-444444444444'), 'Eve Sly');
