\set ON_ERROR_STOP on
-- The preceding C2 scope fixture installs the captured production policies and
-- enables RLS. All rows and identities here belong to the isolated test DB.
reset role;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((select count(*)=3 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('transactions','monthly_overrides','bill_date_moves')),'C2 restoration writes run against explicitly enabled evidence RLS');

select test.source('c2r-future');
set role authenticated;
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,linked_bill_id,matched_occurrence_date,removed_at,deleted_at,pending)
values
 ('c2r-future-removed',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(test.cutover()+3)::text,-50,'Other','FAKE removed future bill','manual','c2r-future',test.cutover()+3,now(),null,false),
 ('c2r-future-deleted',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(test.cutover()+3)::text,-50,'Other','FAKE deleted future bill','manual','c2r-future',test.cutover()+3,null,now(),false),
 ('c2r-future-pending',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(test.cutover()+3)::text,-50,'Other','FAKE removed pending future bill','manual','c2r-future',test.cutover()+3,now(),null,true);
select test.assert((test.convert('c2r-future')->'transfer'->>'source_bill_id')='c2r-future','removed/deleted future rows do not block a clean conversion');
select test.must_fail($q$update public.transactions set removed_at=null where id='c2r-future-removed'$q$,'RLS removed-to-active future Bill association is rejected','Match future activity');
select test.must_fail($q$update public.transactions set deleted_at=null where id='c2r-future-deleted'$q$,'RLS deleted-to-active future Bill association is rejected','Match future activity');
-- Clearing one flag while the row is still pending is not yet active. The
-- final pending-to-posted transition must revalidate the existing assignment.
update public.transactions set removed_at=null where id='c2r-future-pending';
select test.assert((select pending and removed_at is null from transactions where id='c2r-future-pending'),'a still-pending inactive row can receive ordinary provider removal metadata');
select test.must_fail($q$update public.transactions set pending=false where id='c2r-future-pending'$q$,'RLS pending-to-active future Bill association is rejected','Match future activity');
select test.assert((select removed_at is not null from transactions where id='c2r-future-removed') and (select deleted_at is not null from transactions where id='c2r-future-deleted') and (select pending from transactions where id='c2r-future-pending'),'rejected future restores leave every inactive row unchanged');

reset role;
select test.source('c2r-history');
set role authenticated;
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,linked_bill_id,matched_occurrence_date,removed_at,deleted_at,pending)
values
 ('c2r-history-removed',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(test.local_today()-1)::text,-50,'Other','FAKE removed history','manual','c2r-history',test.local_today()-1,now(),null,false),
 ('c2r-history-deleted',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(test.local_today()-1)::text,-50,'Other','FAKE deleted history','manual','c2r-history',test.local_today()-1,null,now(),false),
 ('c2r-history-pending',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(test.local_today()-1)::text,-50,'Other','FAKE removed pending history','manual','c2r-history',test.local_today()-1,now(),null,true);
select test.convert('c2r-history');
update public.transactions set removed_at=null where id='c2r-history-removed';
update public.transactions set deleted_at=null where id='c2r-history-deleted';
update public.transactions set removed_at=null where id='c2r-history-pending';
update public.transactions set pending=false where id='c2r-history-pending';
select test.assert((select count(*)=3 from transactions where id like 'c2r-history-%' and removed_at is null and deleted_at is null and pending is not true),'historical removed/deleted/pending restores before the cutoff remain allowed under RLS');
update public.transactions set amount=-51,note='FAKE provider corrected history',merchant_name='FAKE updated merchant' where id='c2r-history-removed';
select test.assert((select amount=-51 and merchant_name='FAKE updated merchant' from transactions where id='c2r-history-removed'),'already-active historical amount/name/provider metadata refresh remains allowed');
update public.transactions set removed_at=now() where id='c2r-history-removed';
update public.transactions set deleted_at=now() where id='c2r-history-deleted';
update public.transactions set pending=true where id='c2r-history-pending';
select test.assert((select removed_at is not null from transactions where id='c2r-history-removed') and (select deleted_at is not null from transactions where id='c2r-history-deleted') and (select pending from transactions where id='c2r-history-pending'),'active-to-inactive removal/deletion/pending cleanup remains allowed');

-- A future reference in an unrelated household is deliberately invisible to
-- the source household loader. Existing metadata ownership can still move to
-- a surviving member without turning that orphan reference into a new charge.
reset role;
select test.source('c2r-foreign');
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
insert into public.monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day)
values('c2r-foreign-override',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','c2r-foreign',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21);
insert into public.bill_date_moves(id,user_id,household_id,budget_id,bill_id,from_date,to_date)
values('c2c2c2c2-1212-4121-8121-c2c2c2c2c2c2',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','c2r-foreign',test.cutover()+3,test.cutover()+4);
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,linked_bill_id,matched_occurrence_date)
values
 ('c2r-foreign-transaction',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',(test.cutover()+3)::text,-50,'Other','FAKE foreign future reference','manual','c2r-foreign',test.cutover()+3),
 ('c2r-foreign-hop',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',(test.cutover()+3)::text,-50,'Other','FAKE unallocated scope-hop reference','manual','c2r-foreign',test.cutover()+3);
select test.assert((select count(*)=1 from transactions where id='c2r-foreign-transaction'),'foreign actor creates only its own household transaction through actual RLS');
-- Production reconciliation writes are trusted-only; pending target policy
-- also validates the Bill household. These two legacy orphan fixtures are
-- seeded as postgres, never misrepresented as authenticated Data API inserts.
reset role;
insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,occurrence_date)
values('c2r-foreign-transaction','44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bill','c2r-foreign',test.cutover()+3);
insert into public.plaid_transactions(id,user_id,household_id,plaid_account_id,plaid_transaction_id,transaction_date,name,amount,pending,raw,created_at,updated_at)
values(gen_random_uuid(),'44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-4000-8000-000000000006','c2r-foreign-pending',test.local_today(),'FAKE foreign hold',50,true,'{}',now(),now());
insert into public.pending_plan_matches(user_id,household_id,budget_id,pending_plaid_transaction_id,target_id,target_name,occurrence_date,planned_amount,pending_amount,pending_transaction_date,created_by)
values('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','c2r-foreign-pending','c2r-foreign','FAKE foreign hold',test.cutover()+3,50,50,test.local_today(),'44444444-4444-4444-8444-444444444444');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((test.convert('c2r-foreign')->'transfer'->>'source_bill_id')='c2r-foreign','invisible foreign future references across evidence tables do not prevent conversion');
reset role;
select test.assert(private.reassign_shared_plan_ownership('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222')>0,'exact shared ownership helper permits metadata reassignment that stays in the foreign household');
select test.assert((select user_id='22222222-2222-4222-8222-222222222222' from monthly_overrides where id='c2r-foreign-override') and (select user_id='22222222-2222-4222-8222-222222222222' from bill_date_moves where id='c2c2c2c2-1212-4121-8121-c2c2c2c2c2c2') and (select user_id='22222222-2222-4222-8222-222222222222' from transactions where id='c2r-foreign-transaction') and (select user_id='22222222-2222-4222-8222-222222222222' from transaction_reconciliations where transaction_id='c2r-foreign-transaction'),'foreign override/move/transaction/reconciliation ownership updates preserve every orphan record without source exposure');
-- This orphan pending target fails the production authenticated target-scope
-- policy independently of our trigger. Its trusted provider metadata path is
-- exercised as postgres; the transaction checks below use authenticated RLS.
update public.pending_plan_matches set updated_at=clock_timestamp() where pending_plaid_transaction_id='c2r-foreign-pending';
select test.assert((select count(*)=1 from pending_plan_matches where pending_plaid_transaction_id='c2r-foreign-pending'),'foreign pending metadata refresh stays available');
set role authenticated;
update public.transactions set note='FAKE foreign note correction' where id='c2r-foreign-transaction';
select test.assert((select note='FAKE foreign note correction' from transactions where id='c2r-foreign-transaction'),'authenticated foreign note correction remains allowed');
-- An allocated match intentionally disallows a user's amount/date edits in
-- the preexisting guard. A trusted provider can refresh that observation.
reset role;
update public.transactions set amount=-52 where id='c2r-foreign-transaction';
select test.assert((select amount=-52 from transactions where id='c2r-foreign-transaction'),'foreign provider metadata stays available with unchanged future binding');
set role authenticated;
-- This separate legacy manual row has no reconciliation or allocated-match
-- marker, so the old allocation guard cannot mask the new scope protection.
select test.must_fail($q$update public.transactions set household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',budget_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' where id='c2r-foreign-hop'$q$,'RLS scope-only transaction hop into the retired source household is rejected','Match future activity');
select test.assert((select household_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' from transactions where id='c2r-foreign-hop'),'rejected scope exposure preserves the foreign transaction');
reset role;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
\echo BILL CONVERSION C2 RESTORATION TESTS COMPLETE
