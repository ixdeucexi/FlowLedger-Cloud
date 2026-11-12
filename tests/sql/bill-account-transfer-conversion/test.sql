\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert(not has_function_privilege('anon','public.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb)','EXECUTE'),'conversion RPC denies anon and service roles');
select test.assert(not(select prosecdef from pg_proc where oid='public.convert_bill_to_planned_transfer(uuid,uuid,text,jsonb,jsonb)'::regprocedure),'public conversion uses invoker');
select test.assert(not has_column_privilege('authenticated','public.planned_account_transfers','source_bill_id','UPDATE'),'source link is not client writable');
select test.source('clean');
insert into test.conversion_baselines values('clean',test.expected('clean'));
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,linked_bill_id,matched_occurrence_date,source,review_status)
 values('conversion-history','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',test.local_today()::text,-50,'Other','FAKE paid history','clean',test.local_today(),'manual','matched');
create table test.old_history as select to_jsonb(t) as row from public.transactions t where id='conversion-history';
set role anon;
select test.must_fail($q$select test.convert('clean')$q$,'anonymous conversion denied','permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.must_fail($q$select test.convert('clean')$q$,'viewer cannot convert','Household edit access required');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select test.must_fail($q$select test.convert('clean')$q$,'foreign actor cannot convert','Household access required');
select set_config('request.jwt.claim.sub','',false);
select test.must_fail($q$select test.convert('clean')$q$,'signed-out cannot convert','Household access required');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.must_fail($q$select public.convert_bill_to_planned_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','clean',test.expected('clean'),test.conversion_patch())$q$,'cross-budget denied','budget in this household');
select test.must_fail($q$select test.convert('clean',test.expected('clean')||'{"amount":1}')$q$,'stale source CAS conflicts','Bill changed');
select test.must_fail($q$select test.convert('clean',test.expected('clean')-'amount')$q$,'incomplete source CAS rejected','Refresh this bill');
select test.must_fail($q$select test.convert('clean',null,test.conversion_patch()||'{"source_bill_id":"bad"}')$q$,'extra plan field rejected','Complete the transfer');
select test.must_fail($q$select test.convert('clean',null,test.conversion_patch()||jsonb_build_object('start_date',test.local_today()))$q$,'today is not a future cutover','after today');
select test.must_fail($q$select test.convert('clean',null,test.conversion_patch()||'{"to_account_ref":"bank:00000000-0000-4000-8000-000000000001"}')$q$,'same account rejects atomically','two different cash accounts');
select test.assert((select end_date is null from public.bills where id='clean') and test.plan_for('clean') is null,'failed cases leave source and plans unchanged');
select test.assert((test.convert('clean')->'bill'->>'end_date')=(test.cutover()-1)::text,'conversion retires original before first transfer');
select test.assert(test.plan_for('clean')@>'{"source_bill_id":"clean","name":"FAKE Kids transfer","amount":50,"revision":1}'::jsonb,'one plan with durable scoped source link');
select test.assert((test.convert('clean',(select expected from test.conversion_baselines where id='clean'))->>'retry')::boolean,'lost-response exact retry returns without changes');
select test.assert((select count(*)=1 from jsonb_array_elements(public.get_planned_account_transfer_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')->'transfers') x where x->>'source_bill_id'='clean'),'retry cannot duplicate plan');
select test.assert(not(test.convert('clean',(select expected from test.conversion_baselines where id='clean'))->'transfer'?'last_intent'),'internal receipt never returned');
select test.must_fail($q$select test.convert('clean',(select expected from test.conversion_baselines where id='clean'),test.conversion_patch()||'{"amount":75}')$q$,'different retry conflicts','bill or its transfer changed');
select test.must_fail($q$update public.bills set end_date=null where id='clean'$q$,'ordinary edit cannot resume original','Edit the transfer instead');
update public.bills set category='Utilities' where id='clean';
update public.bills set category='Other' where id='clean';
select test.assert((select category='Other' from bills where id='clean'),'historical non-schedule bill correction remains allowed');
select test.must_fail($q$select test.delete_checked('clean')$q$,'bill physical deletion preserves history','planned_account_transfers_source_bill_fkey');
select test.must_fail($q$select test.recreate_source()$q$,'deferred FK cannot be bypassed by delete/recreate active source','cannot be recreated');
update public.monthly_overrides set paid_amount=49 where bill_id='clean';
select test.assert((select min(paid_amount)=49 from monthly_overrides where bill_id='clean'),'historical payment correction remains allowed');
update public.monthly_overrides set paid_amount=50 where bill_id='clean';
delete from public.monthly_overrides where bill_id='clean' and id=(select min(id) from monthly_overrides where bill_id='clean');
select test.assert((select count(*)=4 from monthly_overrides where bill_id='clean'),'ordinary historical Undo remains allowed');
select test.must_fail($q$insert into public.monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day) values('resurrect',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','clean',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21)$q$,'direct future override cannot resurrect retired bill','Edit future dates in the transfer');
select test.must_fail($q$insert into public.bill_date_moves(user_id,household_id,budget_id,bill_id,from_date,to_date) values(auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','clean',test.local_today(),test.cutover()+20)$q$,'cross-cutover move cannot resurrect retired bill','Edit future dates in the transfer');
select test.must_fail($q$insert into public.pending_plan_matches(user_id,household_id,budget_id,pending_plaid_transaction_id,target_id,target_name,occurrence_date,planned_amount,pending_amount,pending_transaction_date,created_by) values(auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-future','clean','FAKE Kids transfer',test.cutover(),50,50,test.local_today(),auth.uid())$q$,'new pending match cannot target retired source','Review the transfer instead');
select test.must_fail($q$insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,linked_bill_id,matched_occurrence_date) values('future-linked',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',test.cutover()::text,-50,'Other','FAKE','clean',test.cutover())$q$,'future posted matching cannot target retired source','Match future activity');
select test.must_fail($q$update public.transactions set review_allocations=jsonb_build_array(jsonb_build_object('type','bill','targetId','clean','occurrenceDate',test.cutover(),'amount',50)) where id='manual-1'$q$,'future split allocation cannot target retired source','Match future activity');

select test.must_fail($q$insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,occurrence_date) values('manual-1',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bill','clean',test.cutover())$q$,'future reconciliation cannot target retired source','Review the transfer instead');
insert into public.bill_date_moves(user_id,household_id,budget_id,bill_id,from_date,to_date) values(auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','clean',test.local_today()-8,test.local_today()-6);
update public.bill_date_moves set to_date=test.local_today()-5 where bill_id='clean';
delete from public.bill_date_moves where bill_id='clean';
select test.assert(not exists(select 1 from bill_date_moves where bill_id='clean'),'historical move correction and Undo remain allowed');



reset role;
insert into public.plaid_transactions(id,user_id,household_id,plaid_account_id,plaid_transaction_id,transaction_date,name,amount,pending,raw,created_at,updated_at)
 values(gen_random_uuid(),'22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001','fake-historical-pending',test.local_today()-2,'FAKE historical bank hold',50,true,'{}',now(),now());
set role authenticated;

insert into public.pending_plan_matches(user_id,household_id,budget_id,pending_plaid_transaction_id,target_id,target_name,occurrence_date,planned_amount,pending_amount,pending_transaction_date,created_by)
 values(auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-historical-pending','clean','FAKE Kids transfer',test.local_today()-2,50,50,test.local_today()-2,auth.uid());
select test.assert((select count(*)=1 from pending_plan_matches where pending_plaid_transaction_id='fake-historical-pending'),'historical pending matching before cutoff remains allowed');
update public.transactions set review_allocations=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId','clean','occurrenceDate',test.cutover(),'amount',50)) where id='manual-1';
select test.assert((select review_allocations->0->>'source'='goal' from transactions where id='manual-1'),'Goal allocation with same text ID is not a Bill target');
reset role;
insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,occurrence_date,allocations)
 values('manual-1',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','goal','clean',test.cutover(),jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId','clean','occurrenceDate',test.cutover(),'amount',50)));
select test.assert((select resolution='goal' from transaction_reconciliations where transaction_id='manual-1'),'trusted Goal reconciliation ID collision remains allowed');
set role authenticated;


reset role;
insert into budgets(id,household_id,name,is_default) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','FAKE second budget',false);
set role authenticated;
select test.must_fail($q$insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day) values('mismatched-budget-resurrection',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','clean',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21)$q$,'actual member override RLS cannot bypass Bill cutoff with another budget','Edit future dates');
select test.must_fail($q$insert into bill_date_moves(user_id,household_id,budget_id,bill_id,from_date,to_date) values(auth.uid(),null,null,'clean',test.local_today()-1,test.cutover()+20)$q$,'legacy-null scope and a different Bill creator cannot bypass moved cutoff','Edit future dates');
reset role;
select test.source('mismatched-existing');
insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day) values('mismatched-existing-future','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','mismatched-existing',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21);
set role authenticated;
select test.must_fail($q$select test.convert('mismatched-existing')$q$,'preexisting mismatched-budget future override blocks conversion','future bill overrides');

-- Current plan edits remain available and retain linkage/cutoff even if the new
-- transfer is moved, paused, or soft-deleted. The Bill never resumes implicitly.
select test.assert((public.save_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',test.conversion_id('clean'),1,jsonb_build_object('name','Renamed savings','status','paused','start_date',test.cutover()+15))->'transfer'->>'source_bill_id')='clean','ordinary transfer edit retains durable source');
select test.must_fail($q$select test.convert('clean',(select expected from test.conversion_baselines where id='clean'))$q$,'conversion retry after later edit conflicts','bill or its transfer changed');

select test.assert((select end_date=(test.cutover()-1)::text from bills where id='clean'),'later transfer first-date edit never shifts original cutoff');
select test.must_fail($q$insert into public.monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,paid_amount) values('future-orphan',auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','clean',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,50)$q$,'future monetary override without custom date is rejected','Edit future dates');

select public.delete_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',test.conversion_id('clean'),2);
select test.assert((public.get_planned_account_transfer_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')->'transfers')@>jsonb_build_array(jsonb_build_object('source_bill_id','clean','id',test.conversion_id('clean'))),'RPC reload retains source link after soft delete');
select test.must_fail($q$update public.bills set end_date=null where id='clean'$q$,'soft delete does not resume original','Edit the transfer instead');
reset role;
select test.assert((select to_jsonb(t)=(select row from test.old_history) from public.transactions t where id='conversion-history'),'conversion preserves actual history exactly');

create table test.before_protected_delete as select jsonb_build_object(
 'bill',(select to_jsonb(b) from bills b where id='clean'),
 'overrides',(select jsonb_agg(to_jsonb(o) order by o.id) from monthly_overrides o where bill_id='clean'),
 'history',(select to_jsonb(t) from transactions t where id='conversion-history')) as snapshot;
set role authenticated;
select test.must_fail($q$select test.delete_checked('clean')$q$,'real delete RPC rolls back its earlier cleanup','planned_account_transfers_source_bill_fkey');
reset role;
select test.assert((select snapshot=jsonb_build_object(
 'bill',(select to_jsonb(b) from bills b where id='clean'),
 'overrides',(select jsonb_agg(to_jsonb(o) order by o.id) from monthly_overrides o where bill_id='clean'),
 'history',(select to_jsonb(t) from transactions t where id='conversion-history')) from test.before_protected_delete),'real delete cleanup rolls back preserving Bill, payments and actual links');

update public.transactions set merchant_name='FAKE corrected bank label',amount=-50.01,date=(test.cutover()+1)::text where id='conversion-history';
select test.assert((select merchant_name='FAKE corrected bank label' and amount=-50.01 from public.transactions where id='conversion-history'),'ordinary bank metadata/money observation refresh remains allowed');
select test.must_fail($q$update public.planned_account_transfers set source_bill_id=null where source_bill_id='clean'$q$,'even privileged accidental link clearing blocked','source bill history cannot be changed');
select test.must_fail($q$delete from public.planned_account_transfers where source_bill_id='clean'$q$,'physical plan deletion cannot lose association','Keep the converted bill history');
-- Preexisting ambiguous data blocks conversion instead of being edited/deleted.
select test.source('unpaid');
update public.monthly_overrides set paid_amount=0,paid_date=null where bill_id='unpaid' and month=extract(month from test.local_today())::int-1 and year=extract(year from test.local_today())::int;
select test.source('future-override');
insert into public.monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,custom_due_day) values('future-override-date','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','future-override',extract(month from test.cutover())::int-1,extract(year from test.cutover())::int,21);
select test.source('future-move');
insert into public.bill_date_moves(user_id,household_id,budget_id,bill_id,from_date,to_date) values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','future-move',test.local_today()-8,test.cutover()+20);
select test.source('pending');
insert into public.pending_plan_matches(user_id,household_id,budget_id,pending_plaid_transaction_id,target_id,target_name,occurrence_date,planned_amount,pending_amount,pending_transaction_date,created_by) values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-pending','pending','FAKE Kids transfer',test.local_today(),50,50,test.local_today(),'11111111-1111-4111-8111-111111111111');
select test.source('debt');update public.bills set is_debt=true where id='debt';
select test.source('weekly');update public.bills set frequency='weekly' where id='weekly';
select test.source('reserved-prefix');
set role authenticated;
select test.must_fail($q$select test.convert('unpaid')$q$,'unpaid original not silently dropped','unpaid payments');
select test.must_fail($q$select test.convert('future-override')$q$,'future override source rejected','future bill overrides');
select test.must_fail($q$select test.convert('future-move')$q$,'cross-cutover move rejected','moved bill payments');
select test.must_fail($q$select test.convert('pending')$q$,'pending source rejected','Finish matching pending');
select test.must_fail($q$select test.convert('debt')$q$,'debt conversion unavailable','Only monthly bills');
select test.must_fail($q$select test.convert('weekly')$q$,'weekly not silently remapped','Only monthly bills');
select public.save_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',test.conversion_id('reserved-prefix'),null,test.conversion_patch());
select test.must_fail($q$select test.convert('reserved-prefix')$q$,'ordinary reserved prefix is not genuine conversion','bill or its transfer changed');
update public.bills set name='Still editable' where id='reserved-prefix';
select test.assert((select name='Still editable' and end_date is null from public.bills where id='reserved-prefix'),'forged prefix cannot freeze unrelated source');

select test.must_fail($q$select public.save_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bad-source-link',null,test.conversion_patch()||'{"source_bill_id":"unpaid"}')$q$,'ordinary plan API cannot inject source association','Unsupported transfer field');
select test.must_fail($q$insert into public.bill_date_moves(user_id,bill_id,from_date,to_date) values('11111111-1111-4111-8111-111111111111','clean',test.local_today()-1,test.cutover()+20)$q$,'legacy null-household move cannot bypass cutoff guard','Edit future dates');

reset role;
select test.source('rollback');
create function test.inject_bill_failure() returns trigger language plpgsql as $$begin if new.id='rollback' then raise exception 'fixture injected failure';end if;return new;end$$;
create trigger fixture_failure before update on public.bills for each row execute function test.inject_bill_failure();
set role authenticated;
select test.must_fail($q$select test.convert('rollback')$q$,'failure between plan and source is atomic','fixture injected failure');
select test.assert((select end_date is null from public.bills where id='rollback') and test.plan_for('rollback') is null,'injected failure rolls back both entities');
reset role;
drop trigger fixture_failure on public.bills;

select test.source('once');update bills set is_recurring=false,next_payment_date=(test.cutover()+4)::text,start_date=test.local_today()::text where id='once';
set role authenticated;
select test.assert((test.convert('once',null,test.conversion_patch()||jsonb_build_object('frequency','once','start_date',test.cutover()+1))->'transfer'->>'frequency')='once','supported future one-time source converts once');
reset role;
select test.source('retry-inactive');insert into test.conversion_baselines values('retry-inactive',test.expected('retry-inactive'));
set role authenticated;select test.convert('retry-inactive');reset role;
update plaid_accounts set is_active=false where id='00000000-0000-4000-8000-000000000003';
set role authenticated;
select test.assert((test.convert('retry-inactive',(select expected from test.conversion_baselines where id='retry-inactive'))->>'retry')::boolean,'exact lost-response retry needs no new endpoint validation');
reset role;update plaid_accounts set is_active=true where id='00000000-0000-4000-8000-000000000003';



select test.source('domain-existing');
insert into incomes(id,user_id,household_id,budget_id,name,amount,frequency,start_date) values('domain-existing','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE same-ID income',50,'monthly',test.cutover()::text);
update transactions set review_allocations=jsonb_build_array(jsonb_build_object('type','income','targetId','domain-existing','occurrenceDate',test.cutover(),'amount',50)) where id='manual-1';
update transaction_reconciliations set resolution='income',target_id='domain-existing',occurrence_date=test.cutover(),allocations=jsonb_build_array(jsonb_build_object('type','income','targetId','domain-existing','occurrenceDate',test.cutover(),'amount',50)) where transaction_id='manual-1';
set role authenticated;
select test.assert((test.convert('domain-existing')->'transfer'->>'source_bill_id')='domain-existing','preexisting Income allocation and reconciliation sharing a Bill ID do not block conversion');
update transactions set review_allocations=jsonb_build_array(jsonb_build_object('type','income','targetId','domain-existing','occurrenceDate',test.cutover()+2,'amount',50)) where id='manual-1';
select test.assert((select review_allocations->0->>'type'='income' from transactions where id='manual-1'),'future Income assignment sharing converted Bill ID remains allowed');
reset role;

-- Real UI expected semantics: ordinary SQL monthly rows have NULL weekday.
select test.source('normalized-null-weekday');
set role authenticated;
select test.assert((test.expected('normalized-null-weekday')->>'day_of_week')='0','fixture submits UI-normalized weekday, not raw SQL NULL');
select test.assert((test.convert('normalized-null-weekday')->'transfer'->>'source_bill_id')='normalized-null-weekday','ordinary NULL weekday source converts with normalized UI baseline');
reset role;
-- Other defaults are NOT NULL in today's hosted schema; loosen only this fake
-- table to verify conservative legacy payload compatibility without backfill.
alter table bills alter column frequency drop not null,alter column smart_priority drop not null,alter column include_in_snowball drop not null,alter column balance drop not null,alter column interest_rate drop not null,alter column debt_payment_pauses drop not null;
select test.source('normalized-legacy');
update bills set frequency=null,smart_priority=null,include_in_snowball=null,balance=null,interest_rate=null,debt_payment_pauses=null where id='normalized-legacy';
insert into test.conversion_baselines values('normalized-legacy',test.expected('normalized-legacy')||'{"frequency":"monthly","day_of_week":0,"smart_priority":"must","include_in_snowball":true,"balance":0,"interest_rate":0,"debt_payment_pauses":[]}'::jsonb);
set role authenticated;
select test.must_fail($q$select test.convert('normalized-legacy',(select expected from test.conversion_baselines where id='normalized-legacy')||'{"amount":51}')$q$,'normalized legacy CAS still rejects real value changes','Bill changed');
select test.assert((test.convert('normalized-legacy',(select expected from test.conversion_baselines where id='normalized-legacy'))->'transfer'->>'source_bill_id')='normalized-legacy','legacy NULL defaults match actual normalized UI expected payload');
select test.assert((test.convert('normalized-legacy',(select expected from test.conversion_baselines where id='normalized-legacy'))->>'retry')::boolean,'normalized legacy payload remains retry-idempotent');
reset role;

-- Sources for real concurrent sessions.
select test.source('race-same');select test.source('race-cas');select test.source('race-evidence');select test.source('race-revoke');select test.source('race-after');select test.source('race-after-exception');
insert into test.conversion_baselines select id,test.expected(id) from public.bills where id like 'race-%';
\echo BILL CONVERSION DATABASE TESTS COMPLETE
