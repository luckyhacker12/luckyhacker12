-- ===========================================================================
-- CALLPRO CRM - RLS verification fixtures (local only, synthetic data)
--
-- Runs as the migration role, i.e. auth.uid() is NULL, which is the trusted
-- server context the guard triggers deliberately allow through.
-- ===========================================================================

-- Three auth users: one admin, two employees. The trigger creates the profiles
-- with role 'employee' for all three, so promotion to admin is an explicit step.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'ada@example.test',  '{"full_name":"Ada Admin"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test',  '{"full_name":"Bob Alpha"}'),
  ('33333333-3333-3333-3333-333333333333', 'cara@example.test', '{"full_name":"Cara Beta"}');

update public.profiles set role = 'admin'
 where id = '11111111-1111-1111-1111-111111111111';

-- Leads: two owned by Bob, one by Cara, one unassigned.
insert into public.leads (id, name, phone, status, assigned_to, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Lead One',   '+15550000001', 'New',        '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Lead Two',   '+15550000002', 'Interested', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Lead Three', '+15550000003', 'New',        null,                                   '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Lead Four',  '+15550000004', 'Converted',  '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

-- One call each from Bob and Cara.
insert into public.call_logs (lead_id, employee_id, outcome, note) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Answered', 'Bob spoke to the owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Answered', 'Cara left a voicemail');

-- Follow-ups: two pending for Bob (one overdue, one due today), one done for Cara.
insert into public.follow_ups (lead_id, assigned_to, due_at, note, status) values
  -- "Later today": clamped so it is always in the future yet still within today,
  -- which keeps the overdue / due-today assertions independent of the clock.
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   least(now() + interval '2 hours',
         date_trunc('day', now()) + interval '1 day' - interval '1 second'),
   'Call back after lunch', 'pending'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   date_trunc('day', now()) - interval '1 hour', 'Paperwork chase', 'pending'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   least(now() + interval '2 hours',
         date_trunc('day', now()) + interval '1 day' - interval '1 second'),
   'Already finished', 'done');

-- Attendance: Bob is present today.
insert into public.attendance (employee_id, work_date, status) values
  ('22222222-2222-2222-2222-222222222222', current_date, 'present');
