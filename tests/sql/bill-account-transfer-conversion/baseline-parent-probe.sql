\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0',false);
insert into auth.users values('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0');
insert into households(id,created_by) values('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0');
insert into household_members(household_id,user_id,role) values('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0','owner');
insert into budgets(id,household_id) values('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1');
insert into household_settings(household_id,budget_id,time_zone) values('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','America/Chicago');
insert into accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('probe-from','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','FAKE probe from','checking',1000),('probe-to','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','FAKE probe to','savings',200);
insert into bills(id,user_id,household_id,budget_id,name,amount,due_day,start_date,created_at,funding_account_ref) values('probe-funded','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','FAKE funded probe',50,4,date_trunc('month',test.local_today()::timestamp)::date::text,'fixture','manual:probe-from');
insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,paid_amount,paid_date) values('probe-paid','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','probe-funded',extract(month from test.local_today())::int-1,extract(year from test.local_today())::int,50,least(date_trunc('month',test.local_today()::timestamp)::date+3,test.local_today()));
do $$begin
 if to_regprocedure('public.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb)') is not null then
  perform public.convert_bill_to_planned_transfer('f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1','f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2','probe-funded',test.expected('probe-funded'),test.conversion_patch()||'{"from_account_ref":"manual:probe-from","to_account_ref":"manual:probe-to"}');
 end if;
 begin
  delete from households where id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f1';
  set constraints all immediate;
  raise notice 'PARENT_PROBE HH SUCCESS';
 exception when others then raise notice 'PARENT_PROBE HH % %',sqlstate,sqlerrm;end;
 begin
  delete from budgets where id='f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f2';
  set constraints all immediate;
  raise notice 'PARENT_PROBE BUDGET SUCCESS';
 exception when others then raise notice 'PARENT_PROBE BUDGET % %',sqlstate,sqlerrm;end;
end$$;
rollback;
