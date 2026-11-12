\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*)=4 and bool_and(relrowsecurity) from pg_class where oid in('public.monthly_overrides'::regclass,'public.bill_date_moves'::regclass,'public.transactions'::regclass,'public.transaction_reconciliations'::regclass)),'C2 explicitly enforces actual captured evidence RLS');
select test.source('c2s-foreign-future');select test.source('c2s-foreign-paid');select test.source('c2s-hop');select test.source('c2s-same-hh-budget');
delete from monthly_overrides where bill_id='c2s-foreign-paid' and month=extract(month from test.local_today())::int-1 and year=extract(year from test.local_today())::int;
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day)
 values('c2s-invisible-future',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','c2s-foreign-future',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21),
 ('c2s-invisible-invalid-date',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','c2s-foreign-future',99,0,21);
insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,paid_amount,paid_date)
 values('c2s-invisible-paid',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','c2s-foreign-paid',extract(month from test.local_today())::int-1,extract(year from test.local_today())::int,50,test.local_today());
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,linked_bill_id,matched_occurrence_date)
 values('c2s-hop-record',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',test.cutover()::text,-50,'Other','FAKE foreign binding','manual','c2s-hop',test.cutover());
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source)
 values('c2s-hop-control',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',test.cutover()::text,-50,'Other','FAKE unbound control','manual');
select test.assert((select count(*)=2 from monthly_overrides where id in('c2s-invisible-future','c2s-invisible-invalid-date')),'C2 foreign actor can create its own actual-RLS rows with arbitrary target IDs');
select test.must_fail($q$insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year) values('c2s-foreign-write-denied',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','c2s-foreign-future',1,2099)$q$,'C2 actual RLS rejects foreign household writes','row-level security');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*)=0 from monthly_overrides where id like 'c2s-invisible-%'),'C2 actual RLS excludes another household evidence');
select test.assert((test.convert('c2s-foreign-future')->'transfer'->>'source_bill_id')='c2s-foreign-future','C2 invisible foreign future and invalid-year rows cannot deny conversion');
select test.must_fail($q$select test.convert('c2s-foreign-paid')$q$,'C2 foreign paid fact cannot settle source-household unpaid obligation','unpaid payments');
select test.assert((test.convert('c2s-hop')->'transfer'->>'source_bill_id')='c2s-hop','C2 foreign transaction binding is excluded from source app scope before conversion');
insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day)
 values('c2s-other-budget',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','c2s-same-hh-budget',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21);
select test.must_fail($q$select test.convert('c2s-same-hh-budget')$q$,'C2 any-budget same-household future row remains app-admissible and blocks conversion','future bill overrides');
reset role;
insert into household_members(household_id,user_id,role) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','editor') on conflict do nothing;
insert into budgets(id,household_id,name,is_default) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','FAKE second foreign budget',false) on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
update transactions set note='FAKE provider correction',amount=-51 where id='c2s-hop-record';
select test.assert((select amount=-51 from transactions where id='c2s-hop-record'),'C2 unchanged foreign binding provider/name/amount update remains allowed');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
update transactions set user_id=auth.uid(),budget_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' where id='c2s-hop-record';
select test.assert((select household_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and budget_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' from transactions where id='c2s-hop-record'),'C2 foreign-to-foreign ownership/budget metadata changes remain permitted');
select test.must_fail($q$update transactions set household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',budget_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',user_id=auth.uid() where id='c2s-hop-record'$q$,'C2 unchanged future binding cannot hop into admitted household scope','Match future activity');
update transactions set household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',budget_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',user_id=auth.uid() where id='c2s-hop-control';
select test.assert((select household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' from transactions where id='c2s-hop-control'),'C2 unbound scope-hop control passes actual RLS for dual-household editor');
reset role;
update households set is_personal=true where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select test.source('c2s-personal-cousin');update bills set user_id='22222222-2222-4222-8222-222222222222' where id='c2s-personal-cousin';
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into bill_date_moves(user_id,bill_id,from_date,to_date) values(auth.uid(),'c2s-personal-cousin',test.local_today()-1,test.cutover()+20);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*)=0 from bill_date_moves where bill_id='c2s-personal-cousin'),'C2 cousin cannot read personal owner legacy row through actual RLS');
select test.must_fail($q$select test.convert('c2s-personal-cousin')$q$,'C2 current personal owner legacy view is protected despite different Bill creator and converter','moved bill payments');
reset role;
-- Today's table is NOT NULL. This isolated compatibility case represents the
-- legacy NULL shape still admitted by the real owner policies and app loader.
alter table monthly_overrides alter column household_id drop not null;
select test.source('c2s-ambiguous-paid');select test.source('c2s-foreign-legacy-paid');
delete from monthly_overrides where bill_id='c2s-foreign-legacy-paid' and month=extract(month from test.local_today())::int-1 and year=extract(year from test.local_today())::int;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
insert into monthly_overrides(id,user_id,bill_id,month,year,paid_amount,paid_date)
 values('c2s-owner-duplicate',auth.uid(),'c2s-ambiguous-paid',extract(month from test.local_today())::int-1,extract(year from test.local_today())::int,50,test.local_today());
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
insert into monthly_overrides(id,user_id,bill_id,month,year,paid_amount,paid_date)
 values('c2s-nonowner-legacy-paid',auth.uid(),'c2s-foreign-legacy-paid',extract(month from test.local_today())::int-1,extract(year from test.local_today())::int,50,test.local_today());
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.must_fail($q$select test.convert('c2s-ambiguous-paid')$q$,'C2 multiple admitted paid rows are rejected rather than arbitrarily choosing one','duplicate bill payment records');
select test.must_fail($q$select test.convert('c2s-foreign-legacy-paid')$q$,'C2 nonowner legacy paid fact cannot settle a personal household source','unpaid payments');
reset role;
update households set is_personal=false where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
-- Restore the synthetic creator used solely for the legacy-owner scope probe;
-- the older regression concurrency test must be able to revoke editor222.
update bills set user_id='11111111-1111-4111-8111-111111111111' where id='c2s-personal-cousin';
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
\echo BILL CONVERSION C2 SCOPE TESTS COMPLETE
