\set ON_ERROR_STOP on
create function test.plan_patch() returns jsonb language sql immutable as $$select '{"name":"Monthly savings","amount":100,"from_account_ref":"bank:00000000-0000-4000-8000-000000000001","to_account_ref":"bank:00000000-0000-4000-8000-000000000003","frequency":"monthly","start_date":"2028-01-31","end_date":null,"status":"active"}'::jsonb$$;
create function test.save_plan(p_id text,p_revision bigint,p_patch jsonb) returns jsonb language sql volatile as $$select public.save_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',p_id,p_revision,p_patch)$$;
create function test.state(p_id text,p_date date,p_template bigint,p_revision bigint,p_patch jsonb) returns jsonb language sql volatile as $$select public.save_planned_account_transfer_occurrence('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',p_id,p_date,p_template,p_revision,p_patch)$$;
create function test.erase(p_id text,p_revision bigint) returns jsonb language sql volatile as $$select public.delete_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',p_id,p_revision)$$;
create function test.data() returns jsonb language sql stable as $$select public.get_planned_account_transfer_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$;
-- Migration never alters preexisting financial rows or policies.
do $$declare b record; current_rows jsonb;begin
 for b in select * from test.transfer_before_rows loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',b.table_name) into current_rows;
 perform test.assert(current_rows=b.rows,'migration preserves '||b.table_name);
 end loop;
 perform test.assert(not exists((select * from test.transfer_before_policies except select * from pg_policies where schemaname='public' and tablename not in('planned_account_transfers','planned_account_transfer_occurrences')) union all (select * from pg_policies where schemaname='public' and tablename not in('planned_account_transfers','planned_account_transfer_occurrences') except select * from test.transfer_before_policies)),'all existing RLS unchanged');
end$$;
select test.assert((select count(*)=2 and bool_and(relrowsecurity) from pg_class where oid in('public.planned_account_transfers'::regclass,'public.planned_account_transfer_occurrences'::regclass)),'both new tables have RLS');
select test.assert(not has_table_privilege('authenticated','public.planned_account_transfers','INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','public.planned_account_transfer_occurrences','INSERT,UPDATE,DELETE'),'no direct authenticated metadata writes');
select test.assert(not has_function_privilege('anon','public.save_planned_account_transfer(uuid,uuid,text,bigint,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.save_planned_account_transfer(uuid,uuid,text,bigint,jsonb)','EXECUTE'),'anonymous and service roles have no RPC grants');
select test.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_planned_account_transfer_data','save_planned_account_transfer','delete_planned_account_transfer','save_planned_account_transfer_occurrence') and p.prosecdef),'public APIs use invoker privileges');
set role anon;
select test.must_fail('select test.data()','anonymous get denied','permission denied');
select test.must_fail($q$select test.save_plan('x',null,test.plan_patch())$q$,'anonymous save denied','permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','',false);
select test.must_fail('select test.data()','missing user explicit access error','Household access required');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select test.must_fail('select test.data()','foreign user get denied','Household access required');
select test.must_fail($q$select test.save_plan('x',null,test.plan_patch())$q$,'foreign user save denied','Household access required');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select test.must_fail('select test.data()','revoked/nonmember get denied','Household access required');
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.assert(test.data()='{"transfers":[],"occurrences":[]}'::jsonb,'viewer reads empty scoped metadata honestly');
select test.must_fail($q$select test.save_plan('viewer',null,test.plan_patch())$q$,'viewer create denied','Household edit access required');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.must_fail($q$select public.get_planned_account_transfer_data('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')$q$,'foreign budget read rejected','budget in this household');
select test.must_fail($q$select public.save_planned_account_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bad-budget',null,test.plan_patch())$q$,'foreign budget save rejected','budget in this household');
select test.assert((test.save_plan('monthly',null,test.plan_patch())->'transfer'->>'revision')::int=1,'editor creates scoped template');
select test.assert((test.save_plan('monthly',null,test.plan_patch())->>'retry')::boolean,'exact create retry idempotent');
select test.assert((select count(*)=1 from public.planned_account_transfers),'retry creates one template');
select test.assert(not ((test.data()->'transfers'->0)?'last_intent'),'RPC omits internal receipt');
select test.must_fail('select last_intent from public.planned_account_transfers','direct receipt read denied','permission denied');
select test.must_fail($q$delete from public.planned_account_transfers where id='monthly'$q$,'direct editor delete denied','permission denied');
select test.must_fail($q$select test.save_plan('monthly',null,test.plan_patch()||'{"amount":200}')$q$,'same client ID different create conflicts','Transfer changed');
select test.assert((test.save_plan('monthly',1,'{"amount":125}') ->'transfer'->>'revision')::int=2,'sparse save increments integer revision');
select test.assert((test.save_plan('monthly',1,'{"amount":125}')->>'retry')::boolean,'exact update retry idempotent');
select test.must_fail($q$select test.save_plan('monthly',1,'{"amount":150}')$q$,'stale revision conflicts','Transfer changed');
select test.assert((test.save_plan('monthly',2,'{"amount":100}')->'transfer'->>'amount')::numeric=100,'latest revision edit works');
-- Validate money, fields and strict dates; every failed create is atomic.
do $$declare p jsonb; i int:=0;begin
 foreach p in array array['{"amount":0}'::jsonb,'{"amount":-1}','{"amount":1000000000.01}','{"amount":1.001}','{"amount":"100"}','{"amount":null}','{"name":""}','{"name":10}','{"frequency":"weekly"}','{"status":"deleted"}','{"start_date":"2028-02-30"}','{"start_date":"2028-2-1"}','{"start_date":"2028-01-32"}','{"end_date":"2027-12-31"}','{"household_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}','{"from_account_ref":null}'] loop
 i:=i+1;perform test.must_fail(format('select test.save_plan(%L,null,test.plan_patch()||%L::jsonb)','invalid-'||i,p::text),'malformed transfer '||i);
 end loop;
end$$;
select test.must_fail($q$select test.save_plan('missing',null,'{"amount":1}')$q$,'partial create rejected','Complete the transfer details');
select test.must_fail($q$select test.save_plan('empty',null,'{}')$q$,'empty patch rejected','Provide transfer changes');
select test.must_fail($q$select test.save_plan('array',null,'[]')$q$,'array patch rejected','Provide transfer changes');
select test.must_fail($q$select test.save_plan('bad-rev',0,test.plan_patch())$q$,'zero revision rejected','valid transfer revision');
select test.assert((test.save_plan('max-money',null,test.plan_patch()||'{"amount":1000000000}') ->'transfer'->>'amount')::numeric=1000000000,'maximum finite cents amount accepted');
-- Canonical account authorization, including explicit bridge/reconnect identity.
do $$declare ref text; i int:=0;begin
 foreach ref in array array['manual:foreign-manual','manual:manual-card','bank:00000000-0000-4000-8000-000000000004','bank:00000000-0000-4000-8000-000000000005','bank:00000000-0000-4000-8000-000000000006','bank:00000000-0000-4000-8000-000000000007','bank:00000000-0000-4000-8000-000000000099','not-an-account'] loop
 i:=i+1;perform test.must_fail(format('select test.save_plan(%L,null,test.plan_patch()||jsonb_build_object(''to_account_ref'',%L))','bad-ref-'||i,ref),'unsafe endpoint '||i);
 end loop;
end$$;
select test.must_fail($q$select test.save_plan('same',null,test.plan_patch()||'{"to_account_ref":"bank:00000000-0000-4000-8000-000000000001"}')$q$,'same physical account rejected','two different cash accounts');
reset role;
update public.plaid_accounts set account_id='manual-checking',persistent_account_id='fixture-checking-physical' where id='00000000-0000-4000-8000-000000000001';
set role authenticated;
select test.must_fail($q$select test.save_plan('same-bridge',null,test.plan_patch()||'{"to_account_ref":"manual:manual-checking"}')$q$,'same physical manual bridge rejected','two different cash accounts');
select test.assert((test.save_plan('bridge-route',null,test.plan_patch()||'{"from_account_ref":"manual:manual-checking"}')->'transfer'->>'from_account_ref')='bank:00000000-0000-4000-8000-000000000001','manual bridge canonicalized without guesses');
-- Date recurrence uses original anchor day and inclusive range.
select test.assert((test.state('monthly','2028-02-29',3,null,'{"skipped":true}')->'occurrence'->>'revision')::int=1,'leap February clipped Jan31 occurrence accepted');
select test.assert((test.state('monthly','2028-02-29',3,null,'{"skipped":true}')->>'retry')::boolean,'occurrence create retry idempotent');
select test.must_fail($q$select test.state('monthly','2028-03-29',3,null,'{"skipped":true}')$q$,'monthly anchor does not drift into March29','scheduled occurrence');
select test.assert((test.state('monthly','2028-03-31',3,null,'{"from_reflected":true,"from_balance_as_of":"2028-03-31"}')->'occurrence'->>'from_reflected')::boolean,'one side explicitly reflected');
select test.must_fail($q$select test.state('monthly','2028-04-30',3,null,'{"from_reflected":true}')$q$,'reflected side requires asof','balance date');
select test.must_fail($q$select test.state('monthly','2028-04-30',3,null,'{"from_reflected":"true"}')$q$,'reflection must be boolean','valid occurrence state');
select test.must_fail($q$select test.state('monthly','2028-04-30',3,null,'{"amount_snapshot":900}')$q$,'client cannot edit frozen snapshot','Unsupported occurrence field');
select test.must_fail($q$select test.state('monthly','2028-04-30',3,null,'{"skipped":true,"use_current_plan":true}')$q$,'reset cannot combine with flags','Reset the occurrence separately');
select test.must_fail($q$select test.state('monthly','2028-04-30',2,null,'{"skipped":true}')$q$,'template CAS protects state','Transfer changed');
select test.must_fail($q$select test.state('monthly','2028-03-31',3,9,'{"skipped":true}')$q$,'occurrence stale CAS protects state','Occurrence changed');
select test.assert((test.state('monthly','2028-03-31',3,1,'{"to_reflected":true,"to_balance_as_of":"2028-04-01"}')->'occurrence'->>'revision')::int=2,'other side independently reflected');
select test.assert((test.state('monthly','2028-03-31',3,2,'{"from_reflected":false}')->'occurrence'->'from_balance_as_of')='null'::jsonb,'clear reflection clears its asof');
select test.assert((test.save_plan('once',null,test.plan_patch()||'{"frequency":"once","start_date":"2027-01-31","end_date":"2027-01-31"}') ->'transfer'->>'revision')::int=1,'oneoff plan supported');
select test.assert((test.state('once','2027-01-31',1,null,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'oneoff first exact date accepted');
select test.must_fail($q$select test.state('once','2027-02-28',1,null,'{"skipped":true}')$q$,'oneoff never recurs','scheduled occurrence');
select test.assert((test.save_plan('nonleap',null,test.plan_patch()||'{"start_date":"2027-01-31","end_date":"2027-03-31"}') ->'transfer'->>'revision')::int=1,'nonleap range plan created');
select test.assert((test.state('nonleap','2027-02-28',1,null,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'nonleap February28 accepted');
select test.assert((test.state('nonleap','2027-03-31',1,null,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'inclusive end occurrence accepted');
select test.must_fail($q$select test.state('nonleap','2027-04-30',1,null,'{"skipped":true}')$q$,'date after end excluded','scheduled occurrence');
-- Series changes do not rewrite reviewed occurrence money, endpoints or dates.
select test.assert((test.save_plan('monthly',3,'{"amount":200,"to_account_ref":"bank:00000000-0000-4000-8000-000000000002","start_date":"2028-01-15","end_date":"2028-02-15"}')->'transfer'->>'revision')::int=4,'series amount endpoint day and end edit succeeds');
select test.assert((test.state('monthly','2028-03-31',4,3,'{"skipped":true}')->'occurrence'->>'amount_snapshot')::numeric=100,'old reviewed date retains original amount after series edit');
select test.assert((select to_account_ref_snapshot='bank:00000000-0000-4000-8000-000000000003' and template_revision_snapshot=3 from public.planned_account_transfer_occurrences where transfer_id='monthly' and occurrence_date='2028-03-31'),'old reviewed date retains endpoints and originating revision');
select test.must_fail($q$select test.state('monthly','2028-02-15',4,null,'{"skipped":true}')$q$,'changed anchor cannot create second reviewed date in same month','already has a reviewed occurrence');
select test.must_fail($q$select test.state('monthly','2028-03-31',4,4,'{"use_current_plan":true}')$q$,'ended series cannot reset away reviewed outstanding state','no active planned occurrence');
select test.save_plan('monthly',4,'{"end_date":null}');
select test.assert((test.state('monthly','2028-03-31',5,4,'{"use_current_plan":true}')->'occurrence'->>'amount_snapshot')::numeric=200,'active changed-anchor month reset retains original reviewed key');
select test.assert((select not skipped and not from_reflected and not to_reflected and from_balance_as_of is null and to_balance_as_of is null and template_revision_snapshot=5 from public.planned_account_transfer_occurrences where transfer_id='monthly' and occurrence_date='2028-03-31'),'explicit reset clears all previous declarations');
-- A partial reflected occurrence survives pause/soft-delete and stays editable.
select test.save_plan('partial',null,test.plan_patch());
select test.state('partial','2028-01-31',1,null,'{"from_reflected":true,"from_balance_as_of":"2028-01-31"}');
select test.save_plan('partial',1,'{"status":"paused"}');
select test.assert((test.data()->'transfers')@>'[{"id":"partial","status":"paused"}]'::jsonb and (test.data()->'occurrences')@>'[{"transfer_id":"partial","from_reflected":true,"to_reflected":false}]'::jsonb,'atomic read retains paused partial occurrence');
select test.assert((test.erase('partial',2)->'transfer'->>'revision')::int=3,'soft delete retains template tombstone');
select test.assert((test.erase('partial',2)->>'retry')::boolean,'soft delete exact retry idempotent');
select test.assert((test.state('partial','2028-01-31',3,1,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'deleted partial occurrence still skippable');
select test.assert((test.data()->'transfers')@>'[{"id":"partial","revision":3}]'::jsonb and (test.data()->'occurrences')@>'[{"transfer_id":"partial","skipped":true,"from_reflected":true}]'::jsonb,'read includes deleted history and adjustment');
select test.must_fail($q$select test.save_plan('partial',3,'{"status":"active"}')$q$,'deleted plan cannot be silently restored','was deleted');
-- Viewer may read names/scopes but all mutations remain forbidden.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.assert(jsonb_array_length(test.data()->'transfers')>=5,'household viewer reads shared plans');
select test.must_fail($q$select test.save_plan('monthly',4,'{"amount":300}')$q$,'viewer update denied','Household edit access required');
select test.must_fail($q$select test.erase('monthly',4)$q$,'viewer delete denied','Household edit access required');
select test.must_fail($q$select test.state('monthly','2028-03-31',4,5,'{"skipped":true}')$q$,'viewer occurrence update denied','Household edit access required');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select test.assert((select count(*)=0 from public.planned_account_transfers),'foreign direct table RLS hides templates');
select test.assert((select count(*)=0 from public.planned_account_transfer_occurrences),'foreign direct table RLS hides occurrences');
select test.must_fail($q$select test.state('monthly','2028-03-31',4,5,'{"skipped":true}')$q$,'foreign occurrence mutation denied','Household access required');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
-- Inactive accounts cannot strand cancellation of an existing plan.
select test.save_plan('inactive-stop',null,test.plan_patch());
select test.state('inactive-stop','2028-01-31',1,null,'{"from_reflected":true,"from_balance_as_of":"2028-01-31"}');
reset role;
update public.plaid_accounts set is_active=false where id='00000000-0000-4000-8000-000000000003';
set role authenticated;
select test.assert((test.save_plan('inactive-stop',1,'{"status":"paused"}')->'transfer'->>'status')='paused','pause works after endpoint becomes inactive');
select test.must_fail($q$select test.state('inactive-stop','2028-01-31',2,1,'{"from_reflected":false}')$q$,'paused partial cannot silently lose outstanding side','Skip this occurrence');
select test.assert((test.state('inactive-stop','2028-01-31',2,1,'{"from_reflected":false,"skipped":true}')->'occurrence'->>'from_reflected')::boolean=false,'explicit skip and clear works with inactive endpoint');
select test.assert((test.state('inactive-stop','2028-01-31',2,2,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'skip existing inactive occurrence works');
select test.must_fail($q$select test.state('inactive-stop','2028-01-31',2,3,'{"skipped":false}')$q$,'resume inactive occurrence fails','active bank account');
select test.must_fail($q$select test.state('inactive-stop','2028-01-31',2,3,'{"use_current_plan":true}')$q$,'snapshot reset requires active current-month plan','no active planned occurrence');
select test.must_fail($q$select test.save_plan('inactive-stop',2,'{"status":"active"}')$q$,'resume validates active endpoints','active bank account');
select test.must_fail($q$select test.save_plan('inactive-stop',2,'{"to_account_ref":"manual:foreign-manual"}')$q$,'paused status cannot smuggle foreign endpoint','active account');
select test.assert((test.erase('inactive-stop',2)->'transfer'->>'revision')::int=3,'delete works with inactive endpoint');
-- New skip declaration is cancellation only and may use now-inactive plan refs.
select test.assert((test.state('bridge-route','2028-02-29',1,null,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'new scheduled skip works after endpoint unavailable');
reset role;
update public.plaid_accounts set is_active=true where id='00000000-0000-4000-8000-000000000003';
-- Same persistent bank row reconnect canonicalizes without changing snapshots.
insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,persistent_account_id,updated_at)
values('00000000-0000-4000-8000-000000000101','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fixture-reconnect','Reconnected checking','depository','checking','depository','checking',1000,1000,true,'USD','fixture-checking-physical','2030-01-01');
update public.plaid_accounts set is_active=false where id='00000000-0000-4000-8000-000000000001';
set role authenticated;
select test.assert((test.save_plan('reconnect',null,test.plan_patch())->'transfer'->>'from_account_ref')='bank:00000000-0000-4000-8000-000000000101','inactive row alias resolves current reconnect canonical ref');
select test.must_fail($q$select test.save_plan('reconnect-self',null,test.plan_patch()||'{"to_account_ref":"bank:00000000-0000-4000-8000-000000000101"}')$q$,'reconnect aliases cannot transfer to themselves','two different cash accounts');
reset role;
-- No RPC wrote actual money, ledger, goal, category, match or plan records.
do $$declare b record; current_rows jsonb;begin
 for b in select * from test.transfer_before_rows where table_name not in('accounts','plaid_accounts') loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',b.table_name) into current_rows;
 perform test.assert(current_rows=b.rows,'planning RPCs preserve '||b.table_name);
 end loop;
 perform test.assert((select bool_and(a.current_balance=(j->>'current_balance')::numeric and a.balance_as_of=(j->>'balance_as_of')::date) from test.transfer_before_rows snapshot cross join lateral jsonb_array_elements(snapshot.rows) j join public.accounts a on a.id=j->>'id' where snapshot.table_name='accounts'),'manual financial balances and asof unchanged');
 perform test.assert((select bool_and(a.current_balance is not distinct from (j->>'current_balance')::numeric and a.available_balance is not distinct from (j->>'available_balance')::numeric and a.updated_at=(j->>'updated_at')::timestamptz) from test.transfer_before_rows snapshot cross join lateral jsonb_array_elements(snapshot.rows) j join public.plaid_accounts a on a.id=(j->>'id')::uuid where snapshot.table_name='plaid_accounts'),'bank financial balances and observation times unchanged');
end$$;
-- Reset cannot silently cancel a partial after pause/delete/frequency changes.
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.save_plan('reset-guard',null,test.plan_patch());
select test.state('reset-guard','2028-01-31',1,null,'{"from_reflected":true,"from_balance_as_of":"2028-01-31"}');
select test.save_plan('reset-guard',1,'{"status":"paused"}');
select test.must_fail($q$select test.state('reset-guard','2028-01-31',2,1,'{"use_current_plan":true}')$q$,'paused partial reset rejected','no active planned occurrence');
select test.must_fail($q$select test.state('reset-guard','2028-01-31',2,1,'{"from_reflected":false}')$q$,'paused partial last reflection clear rejected','Skip this occurrence');
select test.assert((select from_reflected and not to_reflected and not skipped and revision=1 from public.planned_account_transfer_occurrences where transfer_id='reset-guard'),'failed resets leave outstanding partial and revision untouched');
select test.erase('reset-guard',2);
select test.must_fail($q$select test.state('reset-guard','2028-01-31',3,1,'{"use_current_plan":true}')$q$,'deleted partial reset rejected','no active planned occurrence');
select test.assert((test.state('reset-guard','2028-01-31',3,1,'{"skipped":true,"from_reflected":false}')->'occurrence'->>'skipped')::boolean,'explicit skip can clear deleted partial');
select test.save_plan('reset-once-guard',null,test.plan_patch());
select test.state('reset-once-guard','2028-01-31',1,null,'{"to_reflected":true,"to_balance_as_of":"2028-01-31"}');
select test.save_plan('reset-once-guard',1,'{"frequency":"once","start_date":"2028-02-01"}');
select test.must_fail($q$select test.state('reset-once-guard','2028-01-31',2,1,'{"use_current_plan":true}')$q$,'frequency change cannot reset vanished month','no active planned occurrence');
select test.must_fail($q$select test.state('reset-once-guard','2028-01-31',2,1,'{"to_reflected":false}')$q$,'frequency change cannot clear final reflection implicitly','Skip this occurrence');
select test.assert((test.state('reset-once-guard','2028-01-31',2,1,'{"skipped":true}')->'occurrence'->>'skipped')::boolean,'skip original reviewed date works after frequency change');
reset role;
set role authenticated;
-- Reset keeps the review key but adopts a durable current financial date.
select test.save_plan('dated-reset',null,test.plan_patch()||'{"start_date":"2028-01-05"}');
select test.assert((test.state('dated-reset','2028-01-05',1,null,'{"from_reflected":true,"from_balance_as_of":"2028-01-10"}')->'occurrence'->>'scheduled_date_snapshot')='2028-01-05','initial financial date snapshots reviewed date');
select test.save_plan('dated-reset',1,'{"start_date":"2028-01-25"}');
select test.assert((test.state('dated-reset','2028-01-05',2,1,'{"use_current_plan":true}')->'occurrence'->>'scheduled_date_snapshot')='2028-01-25','explicit reset adopts actual new anchor date in same month');
select test.assert((select occurrence_date='2028-01-05' and scheduled_date_snapshot='2028-01-25' and not from_reflected and not to_reflected from public.planned_account_transfer_occurrences where transfer_id='dated-reset'),'reset retains stable identity separately from financial date');
select test.save_plan('dated-reset',2,'{"start_date":"2028-01-28","amount":250}');
select test.assert((test.state('dated-reset','2028-01-05',3,2,'{"skipped":true}')->'occurrence'->>'scheduled_date_snapshot')='2028-01-25','later series edit and state edit preserve reset financial date');
select test.assert((test.data()->'occurrences')@>'[{"transfer_id":"dated-reset","occurrence_date":"2028-01-05","scheduled_date_snapshot":"2028-01-25","amount_snapshot":100}]'::jsonb,'safe atomic read returns durable date and money snapshot');
reset role;
-- Author deletion preserves the shared plan and reviewed state, clearing only attribution.
insert into auth.users(id) values('66666666-6666-4666-8666-666666666666');
insert into public.household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','66666666-6666-4666-8666-666666666666','editor');
set role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
select test.save_plan('author-retention',null,test.plan_patch());
select test.state('author-retention','2028-01-31',1,null,'{"from_reflected":true,"from_balance_as_of":"2028-01-31"}');
reset role;
delete from auth.users where id='66666666-6666-4666-8666-666666666666';
delete from public.household_members where user_id='66666666-6666-4666-8666-666666666666';
select test.assert((select created_by is null and amount=100 and revision=1 from public.planned_account_transfers where id='author-retention'),'account deletion clears creator attribution without deleting shared plan');
select test.assert((select from_reflected and not to_reflected and amount_snapshot=100 and revision=1 from public.planned_account_transfer_occurrences where transfer_id='author-retention'),'account deletion retains shared partial outstanding state');
-- Separate untouched fixture plans for actual-session lock/CAS proofs.
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.save_plan('race-edit',null,test.plan_patch());
select test.save_plan('race-state',null,test.plan_patch());
select test.save_plan('race-template-state',null,test.plan_patch());
select test.save_plan('race-revoke',null,test.plan_patch());
select test.save_plan('race-downgrade',null,test.plan_patch());
select test.save_plan('race-snapshot',null,test.plan_patch());
select test.save_plan('race-read',null,test.plan_patch());
select test.save_plan('race-delete',null,test.plan_patch());
reset role;
\echo PLANNED TRANSFER DATABASE TESTS COMPLETE
