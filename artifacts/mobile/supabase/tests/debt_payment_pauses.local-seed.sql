-- LOCAL ONLY: insert legacy synthetic bills before the pause column exists.
set test.actor_id='11111111-1111-1111-1111-111111111111';
insert into public.bills(id,user_id,household_id,budget_id,name,amount,balance,is_debt,interest_rate,priority,
  next_payment_date,start_date,end_date,snowball_minimum_boost,created_at) values
  ('debt_a','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Synthetic debt A',100,1000,true,8.5,2,'2026-11-15','2026-01-15','2030-01-15',25,'2026-01-01'),
  ('debt_b','33333333-3333-3333-3333-333333333333','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','dddddddd-dddd-dddd-dddd-dddddddddddd',
   'Synthetic other household',200,2000,true,9,4,'2026-11-15','2026-01-15','2030-01-15',35,'2026-01-01');
insert into public.monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_amount,paid_amount,actual_amount,paid_date) values
  ('override_a','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','debt_a',10,2026,120,21,100,'2026-11-01');
insert into public.pause_test_state values('bill_before',(select to_jsonb(b) from public.bills b where id='debt_a')),
  ('other_bill_before',(select to_jsonb(b) from public.bills b where id='debt_b')),
  ('override_before',(select to_jsonb(o) from public.monthly_overrides o where id='override_a')),
  ('journal_count_before',(select to_jsonb(count(*)) from private.recent_changes)),
  ('capture_before',to_jsonb(pg_get_functiondef('private.capture_recent_change()'::regprocedure))),
  ('policies_before',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='bills'));
