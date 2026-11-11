\set ON_ERROR_STOP on
-- No migration backfill: compare every seeded financial column/row and verify
-- all newly introduced references are NULL before exercising user actions.
do $$declare r record; actual jsonb;begin
 for r in select * from test.before_rows loop
 execute format('select coalesce(jsonb_agg((to_jsonb(t)-''funding_account_ref''-''deposit_account_ref''-''forecast_account_ref'') order by (to_jsonb(t)-''funding_account_ref''-''deposit_account_ref''-''forecast_account_ref'')::text),''[]''::jsonb) from public.%I t',r.table_name) into actual;
 perform test.assert(actual=r.rows,'migration preserves financial rows: '||r.table_name);
 end loop;
 perform test.assert((select count(*)=0 from public.account_forecast_preferences),'migration creates no account preferences');
 perform test.assert((select bool_and(funding_account_ref is null) from bills),'existing bills remain unassigned');
 perform test.assert((select bool_and(forecast_account_ref is null) from transactions),'existing transactions remain unassigned');
end$$;

-- Functions on newly introduced data require authentication; direct preference
-- writes are intentionally disallowed, including for legitimate editors.
set role anon;
select test.must_fail($q$select public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'anonymous catalog','permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.assert(jsonb_array_length(public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))=6,'viewer sees all household bank identities including inactive/credit/EUR');
select test.assert((select count(*)=0 from public.plaid_items),'viewer cannot read owner connection/token row');
select test.assert(public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text not like '%FAKE_SECRET%' and public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text not like '%plaid_item%' and public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text not like '%raw%','safe catalog excludes tokens items raw');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":5}')$q$,'viewer cannot change planning','edit access');
select test.must_fail($q$insert into public.account_forecast_preferences(household_id,account_ref,savings_apy) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',5)$q$,'direct preference insert denied','permission denied');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select test.must_fail($q$select public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'foreign household catalog denied','access required');
select test.assert((select count(*)=0 from public.account_forecast_preferences),'foreign preference SELECT isolated');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select test.must_fail($q$select public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'revoked user catalog denied','access required');
select set_config('request.jwt.claim.sub','',false);
select test.must_fail($q$select public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'authenticated role without user denied','access required');

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$declare first jsonb; second jsonb;begin
 first:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":5}');
 perform test.assert((first->>'savings_apy')::numeric=5 and first->'safety_floor'='null'::jsonb,'editor saves optional Savings APY');
 second:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":5}');
 perform test.assert(first=second,'preference lost-response retry is identical');
 perform test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":7}')$q$,'preference stale revision rejected','changed');
 second:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',(first->>'updated_at')::timestamptz,'{"savings_apy":0,"safety_floor":100}');
 perform test.assert((second->>'savings_apy')::numeric=0 and (second->>'safety_floor')::numeric=100,'explicit zero APY differs from unset');
 first:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',(second->>'updated_at')::timestamptz,'{"savings_apy":null}');
 perform test.assert(first->'savings_apy'='null'::jsonb,'APY can be cleared to unknown');
end$$;
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000001',null,'{"savings_apy":0}')$q$,'checking APY rejected','only available for savings');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":101}')$q$,'APY upper bound','between 0 and 100');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":-1}')$q$,'APY lower bound','between 0 and 100');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":"NaN"}')$q$,'nonnumeric APY rejected','numeric savings APY');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"safety_floor":-1}')$q$,'negative floor rejected','minimum balance');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000004',null,'{"safety_floor":50}')$q$,'credit preference rejected','checking or savings');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000005',null,'{"safety_floor":50}')$q$,'inactive preference rejected','active bank account');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000006',null,'{"safety_floor":50}')$q$,'foreign account reference rejected','active bank account');

select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bill','bill-1','{"funding_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}');
select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=100 from public.bills where id='bill-1'),'bill routing persists without amount mutation');
select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bill','bill-1','{"funding_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bill','bill-1','{"funding_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}')$q$,'routing stale CAS rejected','changed');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','bill','bill-1','{"funding_account_ref":null}','{"funding_account_ref":null}')$q$,'foreign budget rejected','budget in this household');
select test.must_fail($q$update public.bills set funding_account_ref='bank:00000000-0000-4000-8000-000000000006' where id='bill-1'$q$,'direct write foreign routing denied','active bank account');
select test.must_fail($q$update public.bills set funding_account_ref='bank:00000000-0000-4000-8000-000000000004' where id='bill-1'$q$,'direct write credit routing denied','checking or savings');
select test.must_fail($q$update public.bills set funding_account_ref='manual:foreign-manual' where id='bill-1'$q$,'direct write foreign manual routing denied','active account');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','transaction','manual-1','{"forecast_account_ref":null}','{"forecast_account_ref":"bank:00000000-0000-4000-8000-000000000002"}')$q$,'transaction local account revision required','existing transaction account');
select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','transaction','manual-1','{"forecast_account_ref":null,"account_id":"manual-checking"}','{"forecast_account_ref":"bank:00000000-0000-4000-8000-000000000002"}');
select test.assert((select account_id is null and forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' from transactions where id='manual-1'),'bank routing uses separate ref and leaves local FK valid');
select test.must_fail($q$update public.transactions set forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' where id='bank-savings-1'$q$,'bank actual source cannot be rerouted','original account');
select test.must_fail($q$update public.transactions set plaid_account_id='fake-provider-2' where id='bank-savings-1'$q$,'bank provider account immutable','original account');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','transaction','bank-savings-1','{"forecast_account_ref":null,"account_id":null}','{"forecast_account_ref":"bank:00000000-0000-4000-8000-000000000002"}')$q$,'generic routing rejects bank actual','transaction or transfer editor');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert(not has_table_privilege('authenticated','public.plaid_accounts','UPDATE'),'shared bank identities do not grant connection/account control');
select test.must_fail($q$update public.plaid_accounts set current_balance=1 where id='00000000-0000-4000-8000-000000000001'$q$,'shared editor cannot alter bank balance','permission denied');
-- Financial fields and routing either commit together or not at all.
select test.must_fail($q$select public.update_bill_with_override_intents('bill-1','{"amount":100,"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}','{"amount":125,"funding_account_ref":"bank:00000000-0000-4000-8000-000000000006"}')$q$,'bill edit invalid route is atomic','active bank account');
select test.assert((select amount=100 and funding_account_ref='bank:00000000-0000-4000-8000-000000000002' from public.bills where id='bill-1'),'failed bill intent preserves financial fields');
select public.update_bill_with_override_intents('bill-1','{"amount":100,"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}','{"amount":125,"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}');
select test.assert((select amount=125 and funding_account_ref='bank:00000000-0000-4000-8000-000000000001' from public.bills where id='bill-1'),'bill intent saves amount and routing atomically');
select test.must_fail($q$select public.update_bucket_budget_with_account('bucket-1','FAKE gas revised',250,'2026-12-15','{"name":"FAKE gas","target_amount":200,"target_date":"2026-12-01","funding_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000006"}')$q$,'bucket budget invalid route is atomic','active bank account');
select test.assert((select name='FAKE gas' and target_amount=200 and funding_account_ref is null from public.goals where id='bucket-1'),'failed bucket intent leaves budget unchanged');
select public.update_bucket_budget_with_account('bucket-1','FAKE gas revised',250,'2026-12-15','{"name":"FAKE gas","target_amount":200,"target_date":"2026-12-01","funding_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}');
select test.assert((select name='FAKE gas revised' and target_amount=250 and funding_account_ref='bank:00000000-0000-4000-8000-000000000002' from public.goals where id='bucket-1'),'bucket wrapper saves budget and routing');
select public.update_bucket_budget_with_account('bucket-1','FAKE gas revised',250,'2026-12-15','{"name":"FAKE gas","target_amount":200,"target_date":"2026-12-01","funding_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}');

-- Pending planning can point to a bank row without putting its UUID in the
-- local-account FK; row identity and source matching remain unchanged.
select public.create_pending_activity_transaction_with_account('fake-pending-1','pending-created-1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',-25,'2026-11-11','Other','FAKE planned',null,'bank:00000000-0000-4000-8000-000000000002');
select test.assert((select account_id is null and forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=-25 from transactions where id='pending-created-1'),'pending wrapper bank route keeps local FK NULL');
select test.assert((select pending_account_id='00000000-0000-4000-8000-000000000002' and target_id='pending-created-1' from pending_plan_matches where pending_plaid_transaction_id='fake-pending-1'),'pending immutable actual account remains row UUID');
select test.assert((public.create_pending_activity_transaction_with_account('fake-pending-1','pending-created-1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',-25,'2026-11-11','Other','FAKE planned',null,'bank:00000000-0000-4000-8000-000000000002')->>'retry')::boolean,'pending lost-response retry preserved');
select test.must_fail($q$select public.create_pending_activity_transaction_with_account('fake-pending-1','pending-foreign','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',-25,'2026-11-11','Other','FAKE planned',null,'bank:00000000-0000-4000-8000-000000000006')$q$,'pending wrapper foreign route rejects before financial write','active bank account');
select test.assert((select count(*)=0 from transactions where id='pending-foreign'),'failed pending wrapper creates no transaction');
reset role;

create function test.transfer_revision(p_group text) returns jsonb language sql stable security invoker as $$select jsonb_agg(jsonb_build_object('id',id,'amount',amount,'date',date,'account_id',account_id,'forecast_account_ref',forecast_account_ref,'note',note,'category',category) order by case when amount<0 then 0 else 1 end) from public.transactions where transfer_group_id=p_group$$;
grant execute on function test.transfer_revision(text) to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-bank-transfer','fake-bank-from','fake-bank-to',null,'{"amount":200,"date":"2026-11-12","fromAccountRef":"bank:00000000-0000-4000-8000-000000000001","toAccountRef":"bank:00000000-0000-4000-8000-000000000003","fromNote":"FAKE to savings","toNote":"FAKE from checking"}');
select test.assert((select count(*)=2 and sum(amount)=0 and bool_and(account_id is null) and count(distinct forecast_account_ref)=2 from transactions where transfer_group_id='fake-bank-transfer'),'bank transfer is paired zero-sum with valid local FK');
select test.assert((public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-bank-transfer','fake-bank-from','fake-bank-to',null,'{"amount":200,"date":"2026-11-12","fromAccountRef":"bank:00000000-0000-4000-8000-000000000001","toAccountRef":"bank:00000000-0000-4000-8000-000000000003","fromNote":"FAKE to savings","toNote":"FAKE from checking"}')->>'retry')::boolean,'bank transfer lost-response retry');
select test.must_fail($q$select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-bank-transfer','fake-bank-from','fake-bank-to','[]','{"amount":250,"date":"2026-11-12","fromAccountRef":"bank:00000000-0000-4000-8000-000000000001","toAccountRef":"bank:00000000-0000-4000-8000-000000000003"}')$q$,'bank transfer stale CAS rejects','changed');
select test.assert((select max(abs(amount))=200 from transactions where transfer_group_id='fake-bank-transfer'),'failed transfer CAS leaves both amounts unchanged');
select test.must_fail($q$select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-invalid-transfer','fake-bad-from','fake-bad-to',null,'{"amount":100,"date":"2026-11-12","fromAccountRef":"bank:00000000-0000-4000-8000-000000000001","toAccountRef":"bank:00000000-0000-4000-8000-000000000006"}')$q$,'foreign transfer leg rejected atomically','active bank account');
select test.assert((select count(*)=0 from transactions where transfer_group_id='fake-invalid-transfer'),'foreign transfer creates no orphan leg');
select test.must_fail($q$update public.transactions set forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' where id='fake-bank-from'$q$,'direct transfer source edit denied','transfer editor');
select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-bank-transfer','fake-bank-from','fake-bank-to',test.transfer_revision('fake-bank-transfer'),'{}','delete');
select test.assert((select count(*)=2 and bool_and(deleted_at is not null) from transactions where transfer_group_id='fake-bank-transfer'),'transfer delete affects both sides');
select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-bank-transfer','fake-bank-from','fake-bank-to',test.transfer_revision('fake-bank-transfer'),'{}','restore');
select test.assert((select count(*)=2 and bool_and(deleted_at is null) from transactions where transfer_group_id='fake-bank-transfer'),'transfer restore affects both sides');
-- Old clients still use only local ids and can omit new null fields in CAS.
select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-legacy-transfer','fake-local-from','fake-local-to',null,'{"amount":10,"date":"2026-11-12","fromAccountId":"manual-checking","toAccountId":"manual-savings"}');
select test.assert((select count(*)=2 and sum(amount)=0 and bool_and(account_id is not null) and bool_and(forecast_account_ref is null) from transactions where transfer_group_id='fake-legacy-transfer'),'legacy manual transfer remains compatible');
select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-legacy-transfer','fake-local-from','fake-local-to',(select jsonb_agg(e-'forecast_account_ref') from jsonb_array_elements(test.transfer_revision('fake-legacy-transfer')) e),'{}','delete');
select test.assert((select bool_and(deleted_at is not null) from transactions where transfer_group_id='fake-legacy-transfer'),'legacy transfer CAS omitting nullable new field remains compatible');
reset role;

-- Shared account bridge aliases must canonicalize only when explicit and
-- unambiguous. No mask/name matching is attempted.
update public.plaid_accounts set account_id='manual-checking' where id='00000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-checking')->>'ref')='bank:00000000-0000-4000-8000-000000000001','explicit bridge canonicalizes local and bank refs');
select public.update_bill_with_override_intents('bill-1','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}','{"funding_account_ref":"manual:manual-checking"}');
select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000001' from bills where id='bill-1'),'bill retry accepts equivalent explicit bridge alias');
reset role;
update public.plaid_accounts set account_id='manual-checking' where id='00000000-0000-4000-8000-000000000002';
set role authenticated;
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-checking')$q$,'multiple bank bridges rejected','conflicting bank links');
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001')$q$,'bank reference detects shared bridge ambiguity','conflicting bank links');
reset role;
update public.plaid_accounts set account_id=null where id='00000000-0000-4000-8000-000000000002';
update public.plaid_accounts set flowledger_account_id='manual-savings' where id='00000000-0000-4000-8000-000000000001';
set role authenticated;
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001')$q$,'conflicting bridge columns rejected','conflicting bank links');
reset role;
update public.plaid_accounts set flowledger_account_id=null,account_id=null where id='00000000-0000-4000-8000-000000000001';
set role authenticated;
-- Only explicit accountRef/fundingAccountRef can designate a cash source.
select test.assert(private.forecast_sources_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"type":"manual","id":"manual-checking","amount":20}]') is null,'budget/source identifiers are not account authorization');
select test.assert(private.forecast_sources_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"type":"manual","accountRef":"bank:00000000-0000-4000-8000-000000000002","amount":20},{"type":"manual","fundingAccountRef":"bank:00000000-0000-4000-8000-000000000002","amount":10}]')='bank:00000000-0000-4000-8000-000000000002','all explicit same-account extra sources derive scalar route');
select test.assert(private.forecast_sources_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"accountRef":"bank:00000000-0000-4000-8000-000000000001","amount":20},{"accountRef":"bank:00000000-0000-4000-8000-000000000002","amount":10}]') is null,'mixed source accounts remain unassigned scalar');
select test.must_fail($q$select private.forecast_sources_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"accountRef":"bank:00000000-0000-4000-8000-000000000006","amount":20}]')$q$,'source JSON foreign account rejected','active bank account');
select test.must_fail($q$select private.forecast_sources_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"accountRef":"bank:00000000-0000-4000-8000-000000000004","amount":20}]')$q$,'source JSON credit account rejected','checking or savings');
-- Savings bank charge matching uses the actual provider identity and records a
-- single bucket purchase; it never copies expected bucket funding onto bank.
select public.add_bucket_purchase('bucket-1','bank-savings-1',20,'2026-11-11',null);
select test.assert((select source='plaid' and plaid_account_id='fake-provider-3' and forecast_account_ref is null and linked_plan_id='bucket-1' from transactions where id='bank-savings-1'),'Savings posted match preserves actual bank identity');
select test.assert((select current_amount=20 from goals where id='bucket-1'),'actual reconciliation triggers update bucket total once');
select test.assert((public.add_bucket_purchase('bucket-1','bank-savings-1',20,'2026-11-11',null)->>'retry')::boolean,'Savings bucket matching retry idempotent');
select test.assert((select current_amount=20 from goals where id='bucket-1'),'Savings matching retry does not double bucket spending');
select test.must_fail($q$update public.transactions set forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' where id='bank-savings-1'$q$,'allocated purchase source guarded','Undo this transaction match');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','transaction','bank-savings-1','{"forecast_account_ref":null,"account_id":null}','{"forecast_account_ref":"bank:00000000-0000-4000-8000-000000000002"}')$q$,'generic assignment cannot bypass allocated edit guard','transaction or transfer editor');
reset role;
-- Saved preferences remain household-readable but viewers cannot edit.
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.assert((select count(*)=1 from account_forecast_preferences),'viewer reads saved household planning settings');
select test.must_fail($q$update public.account_forecast_preferences set savings_apy=9$q$,'viewer direct preference edit denied','permission denied');
do $$declare changed integer;begin update bills set amount=999 where id='bill-1';get diagnostics changed=row_count;perform test.assert(changed=0,'viewer cannot edit bills through RLS');end$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert(private.forecast_posted_cash_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fake-provider-3'),'posted cash resolver accepts Savings provider id');
select test.assert(not private.forecast_posted_cash_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000003'),'posted cash resolver rejects row-UUID namespace');
select test.assert(not private.forecast_posted_cash_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fake-provider-6'),'posted cash resolver rejects foreign household provider');
select test.must_fail($q$update bills set budget_id=null,funding_account_ref='manual:manual-checking' where id='bill-1'$q$,'manual routing requires exact NULL budget scope','active account');
reset role;
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,plaid_account_id,pending,review_status) values('bank-savings-replace','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-11',-30,'Other','FAKE Savings replacement','plaid','fake-provider-3',false,'needs_review');
set role authenticated;
select public.reconcile_manual_transaction('bank-savings-replace','manual-1','2026-11-11',30,'exact');
select test.assert((select plaid_account_id='fake-provider-3' and forecast_account_ref is null and account_id is null and linked_plan_id='manual-1' from transactions where id='bank-savings-replace'),'manual replacement keeps actual Savings source instead of expected Bills payer');
select test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' and removed_at is not null from transactions where id='manual-1'),'replaced planned metadata retained without duplicating active transaction');
select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','goal','savings-goal','{"funding_account_ref":null,"deposit_account_ref":null}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002","deposit_account_ref":"bank:00000000-0000-4000-8000-000000000003"}');
select public.fund_goal('savings-goal','fake-goal-funding',100,'2026-11-13',0,null);
select test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' and account_id is null and amount=-100 from transactions where id='fake-goal-funding'),'saved goal funding bank route inherited into new transaction');
select test.assert((public.fund_goal('savings-goal','fake-goal-funding',100,'2026-11-13',0,null)->>'retry')::boolean,'goal bank funding retry remains idempotent');
select test.assert((select current_amount=100 from goals where id='savings-goal'),'goal retry does not double contribution');
reset role;
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref) values('fake-decision','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE later','one_time_purchase','{"type":"one_time_purchase","name":"FAKE later","amount":40}','{}','planned','bank:00000000-0000-4000-8000-000000000002');
set role authenticated;
select public.complete_decision('fake-decision',40,'2026-11-14',null,null);
select test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' and account_id is null and amount=-40 from transactions where linked_plan_id='fake-decision'),'saved decision funding bank route inherited into transaction');
select test.assert((public.complete_decision('fake-decision',40,'2026-11-14',null,null)->>'retry')::boolean,'decision completion bank route retry remains idempotent');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert(exists(select 1 from jsonb_array_elements(public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')) a where a->>'currency_code'='EUR'),'catalog safely retains non-USD identity for honest unavailable state');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','income','income-1','{"deposit_account_ref":null}','{"deposit_account_ref":"bank:00000000-0000-4000-8000-000000000007"}')$q$,'EUR account cannot fund USD forecast','USD account');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000007',null,'{"savings_apy":5}')$q$,'EUR account cannot use USD APY estimator','USD account');
select test.must_fail($q$select private.forecast_posted_cash_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fake-provider-7')$q$,'EUR account cannot match USD cash planning','USD account');
select test.must_fail($q$select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','fake-eur-transfer','fake-eur-from','fake-eur-to',null,'{"amount":100,"date":"2026-11-12","fromAccountRef":"bank:00000000-0000-4000-8000-000000000001","toAccountRef":"bank:00000000-0000-4000-8000-000000000007"}')$q$,'EUR transfer cannot silently mix currencies','USD account');
select test.assert((select count(*)=0 from transactions where transfer_group_id='fake-eur-transfer'),'rejected EUR transfer creates no rows');
select test.must_fail($q$select private.forecast_sources_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,'[{"accountRef":"manual:manual-checking","amount":20}]')$q$,'NULL-budget nested source requires exact budget','active account');
reset role;
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,plaid_account_id,pending,review_status) values('fake-eur-posted','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-20',-9,'Other','FAKE EUR charge','plaid','fake-provider-7',false,'needs_review');
set role authenticated;
select test.must_fail($q$select public.add_bucket_purchase('bucket-1','fake-eur-posted',9,'2026-11-20',null)$q$,'EUR posted matching rejects without financial side effect','USD account');
select test.assert((select review_status='needs_review' and linked_plan_id is null from transactions where id='fake-eur-posted'),'EUR rejected matching remains unassigned');
select test.must_fail($q$insert into extra_payments(id,user_id,household_id,budget_id,month,year,amount,allocations,sources) values('fake-null-budget-extra','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,0,2027,20,'[]','[{"accountRef":"manual:manual-checking","amount":20}]')$q$,'direct extra row nested source respects NULL budget scope','active account');
select test.assert((select count(*)=0 from extra_payments where id='fake-null-budget-extra'),'invalid nested source creates no financial row');
reset role;

-- Actual review trigger must preserve distinct legitimate cash charges even
-- when their merchant, date and amount happen to be identical.
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,merchant_name,source,plaid_account_id,pending,review_status) values
('fake-legitimate-checking','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-20',-5,'Other','FAKE same merchant','FAKE shared merchant','plaid','fake-provider-1',false,'needs_review'),
('fake-legitimate-savings','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-20',-5,'Other','FAKE same merchant','FAKE shared merchant','plaid','fake-provider-3',false,'needs_review');
set role authenticated;
select public.add_bucket_purchase('bucket-1','fake-legitimate-checking',5,'2026-11-20',null);
select test.assert((select removed_at is null and review_status='needs_review' from transactions where id='fake-legitimate-savings'),'review does not suppress legitimate matching charge on another cash account');
select test.assert((select current_amount=25 from goals where id='bucket-1'),'distinct cash charges do not double bucket totals');
reset role;
update budgets set is_default=true where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref,deposit_account_ref) values
('fake-recurring','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE recurring','recurring_bill','{"type":"recurring_bill","name":"FAKE recurring","amount":15,"frequency":"monthly"}','{}','planned','bank:00000000-0000-4000-8000-000000000002',null),
('fake-income-existing','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE raise','income_change','{"type":"income_change","name":"FAKE raise","sourceId":"income-1","frequency":"monthly"}','{}','planned',null,'bank:00000000-0000-4000-8000-000000000003'),
('fake-income-new','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE new income','income_change','{"type":"income_change","name":"FAKE new income","frequency":"monthly"}','{}','planned',null,'bank:00000000-0000-4000-8000-000000000001'),
('fake-extra-decision','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE extra','extra_debt_payment','{"type":"extra_debt_payment","name":"FAKE extra","amount":20}','{}','planned','bank:00000000-0000-4000-8000-000000000002',null);
set role authenticated;
select public.complete_decision('fake-recurring',15,'2026-11-20',null,null);
select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=15 from bills where name='FAKE recurring'),'recurring decision bill inherits bank funding');
select test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=-15 from transactions where linked_plan_id='fake-recurring'),'recurring decision payment inherits bank funding');
select public.complete_decision('fake-income-existing',600,'2026-11-20',null,null);
select test.assert((select deposit_account_ref='bank:00000000-0000-4000-8000-000000000003' and amount=600 from incomes where id='income-1'),'income-change update inherits Savings deposit route');
select public.complete_decision('fake-income-new',700,'2026-11-20',null,null);
select test.assert((select deposit_account_ref='bank:00000000-0000-4000-8000-000000000001' and amount=700 from incomes where name='FAKE new income'),'new income decision inherits bank deposit route');
select public.complete_decision('fake-extra-decision',20,'2026-12-10',null,'{"paymentDate":"2026-12-10","selectedExtra":20,"allocations":[{"billId":"bill-1","payment":20}]}');
select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=20 from extra_payments where month=11 and year=2026),'extra-debt decision inherits saved bank payer');
select test.assert((select amount=125 and balance=0 from bills where id='bill-1'),'planned extra does not alter actual debt balance');
reset role;

-- Explicit Savings contributions move cash between accounts and advance only
-- the milestone. Pair creation and its completion receipt are one transaction.
insert into goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,created_at,goal_type)
values('paired-decision-goal','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE paired milestone',5000,'2027-12-01',0,'2026-11-01','savings');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref,deposit_account_ref)
values('paired-savings-decision','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE transfer','savings_contribution','{"type":"savings_contribution","name":"FAKE transfer","sourceId":"paired-decision-goal"}','{}','planned','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000003');
do $$declare first jsonb; retry jsonb; grp text;begin
 first:=public.complete_decision('paired-savings-decision',50,'2026-11-15',null,null);
 retry:=public.complete_decision('paired-savings-decision',50,'2026-11-15',null,null);
 grp:=first->'applied_change'->>'transferGroupId';
 perform test.assert(grp is not null and first->'applied_change'->>'depositTransactionId' is not null,'decision receipt identifies both stable transfer legs');
 perform test.assert((retry->>'retry')::boolean and first->'applied_change'=retry->'applied_change','decision pair identical retry returns original receipt');
 perform test.assert((select count(*)=2 and sum(amount)=0 and count(*)filter(where amount<0)=1 and count(*)filter(where amount>0)=1 and bool_and(category='Transfer') and bool_and(account_id is null) from transactions where transfer_group_id=grp),'decision pair has two opposite cash movements and valid local FK separation');
 perform test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=-50 from transactions where id=first->'applied_change'->>'transactionId'),'decision pair withdraws from explicit funding account');
 perform test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000003' and amount=50 from transactions where id=first->'applied_change'->>'depositTransactionId'),'decision pair deposits into explicit Savings account');
 perform test.assert((select current_amount=50 from goals where id='paired-decision-goal') and (select status='completed' from decisions where id='paired-savings-decision'),'decision pair progresses milestone once and completes');
 perform test.must_fail(format('select public.mutate_transfer(%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb,%L)','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',grp,first->'applied_change'->>'transactionId',first->'applied_change'->>'depositTransactionId',test.transfer_revision(grp),'{}','delete'),'allocated contribution cannot use generic pair deletion without milestone reversal','cannot be changed');
 perform test.must_fail(format('update transactions set deleted_at=now() where id=%L',first->'applied_change'->>'transactionId'),'direct single contribution leg deletion rejected','transfer editor');
 perform test.assert((select count(*)=2 and bool_and(deleted_at is null) from transactions where transfer_group_id=grp) and (select current_amount=50 from goals where id='paired-decision-goal'),'rejected deletion preserves pair and milestone');
end$$;
reset role;
update plaid_accounts set is_active=false where id='00000000-0000-4000-8000-000000000003';
set role authenticated;
select test.assert((public.complete_decision('paired-savings-decision',50,'2026-11-15',null,null)->>'retry')::boolean,'completed decision receipt retry does not require reactivating its bank account');
reset role;
update plaid_accounts set is_active=true where id='00000000-0000-4000-8000-000000000003';

-- A direct goal contribution has the same economic pair semantics.
set role authenticated;
insert into goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,created_at,goal_type,funding_account_ref,deposit_account_ref)
values('paired-direct-goal','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE direct milestone',5000,'2027-12-01',0,'2026-11-01','savings','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000003');
do $$declare first jsonb;retry jsonb;grp text;begin
 first:=public.fund_goal('paired-direct-goal','paired-direct-funding',50,'2026-11-15',0,null);
 retry:=public.fund_goal('paired-direct-goal','paired-direct-funding',50,'2026-11-15',0,null);
 grp:=first->>'transfer_group_id';
 perform test.assert(grp is not null and first->>'deposit_transaction_id' is not null,'direct contribution receipt identifies stable deposit/group');
 perform test.assert((retry->>'retry')::boolean and retry->>'deposit_transaction_id'=first->>'deposit_transaction_id','direct contribution identical retry reuses pair');
 perform test.assert((select count(*)=2 and sum(amount)=0 and bool_and(account_id is null) from transactions where transfer_group_id=grp) and (select current_amount=50 from goals where id='paired-direct-goal'),'direct contribution pair is net zero and milestone advances once');
 perform test.assert((select forecast_account_ref='bank:00000000-0000-4000-8000-000000000003' and amount=50 from transactions where id=first->>'deposit_transaction_id'),'direct contribution routes positive leg to Savings');
end$$;
insert into goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,created_at,goal_type,funding_account_ref,deposit_account_ref)
values('paired-local-goal','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE local milestone',1000,'2027-12-01',0,'2026-11-01','savings','manual:manual-checking','manual:manual-savings');
select public.fund_goal('paired-local-goal','paired-local-funding',25,'2026-11-15',0,null);
select test.assert((select count(*)=2 and sum(amount)=0 and count(*)filter(where account_id='manual-checking' and amount=-25)=1 and count(*)filter(where account_id='manual-savings' and amount=25)=1 from transactions where linked_plan_id='paired-local-goal'),'manual contribution pair keeps only valid local account IDs');
insert into goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,created_at,goal_type,funding_account_ref)
values('legacy-one-leg-goal','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE unassigned destination',1000,'2027-12-01',0,'2026-11-01','savings','bank:00000000-0000-4000-8000-000000000002');
select public.fund_goal('legacy-one-leg-goal','legacy-one-leg-funding',25,'2026-11-15',0,null);
select test.assert((select count(*)=1 and sum(amount)=-25 and bool_and(transfer_group_id is null) from transactions where linked_plan_id='legacy-one-leg-goal'),'missing explicit destination retains legacy expense without inventing cash');

-- Savings routing rejects literal and canonical self-transfers atomically.
select test.must_fail($q$insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref,deposit_account_ref) values('invalid-self-decision','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE self','savings_contribution','{"type":"savings_contribution","name":"FAKE self","sourceId":"paired-decision-goal"}','{}','planned','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000002')$q$,'literal same-account decision insert rejected','two different accounts');
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref,deposit_account_ref)
values('self-cas-decision','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE route edit','savings_contribution','{"type":"savings_contribution","name":"FAKE route edit","sourceId":"paired-decision-goal"}','{}','planned','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000003');
select test.must_fail($q$select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','decision','self-cas-decision','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000002","deposit_account_ref":"bank:00000000-0000-4000-8000-000000000003"}','{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001","deposit_account_ref":"bank:00000000-0000-4000-8000-000000000001"}')$q$,'same-account decision routing CAS rejected','two different accounts');
select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000002' and deposit_account_ref='bank:00000000-0000-4000-8000-000000000003' from decisions where id='self-cas-decision'),'rejected routing saves neither half');
select test.must_fail($q$update decisions set deposit_account_ref=funding_account_ref where id='self-cas-decision'$q$,'direct same-account decision update rejected','two different accounts');
reset role;
update plaid_accounts set account_id='manual-checking' where id='00000000-0000-4000-8000-000000000001';
set role authenticated;
select test.must_fail($q$update decisions set funding_account_ref='manual:manual-checking',deposit_account_ref='bank:00000000-0000-4000-8000-000000000001' where id='self-cas-decision'$q$,'same physical manual bridge self-transfer rejected','two different accounts');
reset role;
update plaid_accounts set account_id=null where id='00000000-0000-4000-8000-000000000001';
update plaid_accounts set persistent_account_id='FAKE-SELF-PERSISTENT' where id='00000000-0000-4000-8000-000000000003';
insert into plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,is_active,currency_code,persistent_account_id,updated_at)
values('00000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-self-alias','FAKE self alias','depository','savings','depository','savings',2000,true,'USD','FAKE-SELF-PERSISTENT','2026-11-01');
set role authenticated;
select test.must_fail($q$update decisions set funding_account_ref='bank:00000000-0000-4000-8000-000000000003',deposit_account_ref='bank:00000000-0000-4000-8000-000000000020' where id='self-cas-decision'$q$,'same persistent physical self-transfer rejected','two different accounts');
reset role;
delete from plaid_accounts where id='00000000-0000-4000-8000-000000000020';
update plaid_accounts set persistent_account_id=null where id='00000000-0000-4000-8000-000000000003';

-- A preexisting generated deposit ID must roll back the milestone, outgoing
-- leg and completion status together rather than leave a half transfer.
set role authenticated;
insert into goals(id,user_id,household_id,budget_id,name,target_amount,target_date,current_amount,created_at,goal_type,funding_account_ref,deposit_account_ref)
values('collision-direct-goal','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE collision milestone',1000,'2027-12-01',0,'2026-11-01','savings','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000003');
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source)
values('goal-'||md5('collision-direct-funding'||':deposit-transaction'),'22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-15',-1,'Other','FAKE preexisting ID','manual');
select test.must_fail($q$select public.fund_goal('collision-direct-goal','collision-direct-funding',25,'2026-11-15',0,null)$q$,'deposit collision rolls back entire goal contribution','duplicate key');
select test.assert((select current_amount=0 from goals where id='collision-direct-goal') and not exists(select 1 from transactions where id='collision-direct-funding'),'failed direct contribution changes neither progress nor source cash');
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref,deposit_account_ref)
values('collision-savings-decision','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE decision collision','savings_contribution','{"type":"savings_contribution","name":"FAKE collision","sourceId":"collision-direct-goal"}','{}','planned','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000003');
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source)
values('decision-'||md5('collision-savings-decision'||':deposit-transaction'),'22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-15',-1,'Other','FAKE preexisting ID','manual');
select test.must_fail($q$select public.complete_decision('collision-savings-decision',25,'2026-11-15',null,null)$q$,'deposit collision rolls back entire decision completion','duplicate key');
select test.assert((select current_amount=0 from goals where id='collision-direct-goal') and (select status='planned' and actual_amount is null from decisions where id='collision-savings-decision') and not exists(select 1 from transactions where id='decision-'||md5('collision-savings-decision'||':transaction')),'failed decision completion changes no source cash progress or receipt');
reset role;
-- Simulate an invalid preexisting planning row only inside this disposable
-- fixture, proving completion rejects it without repairing/backfilling it.
alter table decisions disable trigger zzz_validate_forecast_account_routing;
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status,funding_account_ref,deposit_account_ref)
values('legacy-invalid-self-decision','22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE old self','savings_contribution','{"type":"savings_contribution","name":"FAKE old self","sourceId":"collision-direct-goal"}','{}','planned','bank:00000000-0000-4000-8000-000000000002','bank:00000000-0000-4000-8000-000000000002');
alter table decisions enable trigger zzz_validate_forecast_account_routing;
set role authenticated;
select test.must_fail($q$select public.complete_decision('legacy-invalid-self-decision',25,'2026-11-15',null,null)$q$,'legacy invalid self-transfer cannot complete','two different accounts');
select test.assert((select current_amount=0 from goals where id='collision-direct-goal') and (select status='planned' and funding_account_ref=deposit_account_ref from decisions where id='legacy-invalid-self-decision') and not exists(select 1 from transactions where linked_plan_id='legacy-invalid-self-decision'),'legacy self-transfer remains untouched and creates no cash movements');
reset role;

-- Creating a bill during review must save the explicitly chosen future payer
-- in the same transaction while the posted charge keeps its real bank source.
insert into transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,plaid_account_id,plaid_transaction_id,pending,review_status)
values('review-new-bill-valid','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-16',-17,'Other','FAKE chosen future payer','plaid','fake-provider-3','fake-review-posted-valid',false,'needs_review'),
('review-new-bill-invalid','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-17',-19,'Other','FAKE invalid future payer','plaid','fake-provider-3','fake-review-posted-invalid',false,'needs_review'),
('review-new-bill-unassigned','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','2026-11-18',-23,'Other','FAKE unassigned future payer','plaid','fake-provider-3','fake-review-posted-unassigned',false,'needs_review');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$declare saved jsonb;retry jsonb;payload jsonb:='{"name":"FAKE newly reviewed bill","amount":17,"category":"Other","frequency":"monthly","funding_account_ref":"bank:00000000-0000-4000-8000-000000000002"}';begin
 saved:=public.create_bill_and_reconcile_transaction('review-new-bill-valid',payload);
 retry:=public.create_bill_and_reconcile_transaction('review-new-bill-valid',payload);
 perform test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000002' and amount=17 from bills where id=saved->>'bill_id'),'review-created bill retains selected Bills payer');
 perform test.assert((select plaid_account_id='fake-provider-3' and forecast_account_ref is null and account_id is null and amount=-17 and review_status='matched' from transactions where id='review-new-bill-valid'),'review-created bill leaves actual Savings source immutable');
 perform test.assert((retry->>'retry')::boolean and saved->>'bill_id'=retry->>'bill_id' and (select count(*)=1 from transaction_reconciliations where transaction_id='review-new-bill-valid'),'review-created bill retry reuses same bill and settlement');
 perform test.must_fail(format('select public.create_bill_and_reconcile_transaction(%L,%L::jsonb)','review-new-bill-valid',payload||'{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}'::jsonb),'review bill retry with changed payer cannot overwrite saved intent','already been reviewed');
 perform test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000002' from bills where id=saved->>'bill_id'),'changed payer retry leaves saved future payer unchanged');
end$$;
select test.must_fail($q$select public.create_bill_and_reconcile_transaction('review-new-bill-invalid','{"name":"FAKE invalid payer","amount":19,"frequency":"monthly","funding_account_ref":"bank:00000000-0000-4000-8000-000000000006"}')$q$,'review-created bill rejects foreign future payer','active bank account');
select test.assert(not exists(select 1 from bills where id='review-bill-'||md5('review-new-bill-invalid')) and not exists(select 1 from transaction_reconciliations where transaction_id='review-new-bill-invalid') and (select review_status='needs_review' and plaid_account_id='fake-provider-3' and linked_bill_id is null from transactions where id='review-new-bill-invalid'),'foreign payer rejection rolls back bill settlement and actual transaction');
select public.create_bill_and_reconcile_transaction('review-new-bill-unassigned','{"name":"FAKE no inferred payer","amount":23,"frequency":"monthly","funding_account_ref":null}');
select test.assert((select funding_account_ref is null from bills where id='review-bill-'||md5('review-new-bill-unassigned')),'review-created bill preserves explicit unassigned payer without guessing actual source');
reset role;

-- Persistent IDs are explicit physical identity, including old disconnected
-- aliases. An inactive old bridge may identify a live reconnected bank row.
update public.plaid_accounts set is_active=false,persistent_account_id='FAKE-SAVINGS-PERSISTENT',account_id='manual-savings',updated_at='2026-01-01' where id='00000000-0000-4000-8000-000000000003';
insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,persistent_account_id,updated_at)
values('00000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-8','FAKE Savings reconnected','depository','savings','depository','savings',2000,2000,true,'USD','FAKE-SAVINGS-PERSISTENT','2026-02-01');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.assert((private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000003')->>'ref')='bank:00000000-0000-4000-8000-000000000008','inactive bank alias resolves explicit active persistent peer');
select test.assert((private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-savings')->>'ref')='bank:00000000-0000-4000-8000-000000000008','inactive old manual bridge carries through persistent identity');
select test.assert((private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-savings')->'aliases') @> '["bank:00000000-0000-4000-8000-000000000003","bank:00000000-0000-4000-8000-000000000008","manual:manual-savings"]','physical aliases include old bank current bank and explicit manual bridge');
select test.assert(private.forecast_posted_cash_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','fake-provider-3'),'posted old provider account remains recognized through explicit persistent identity');
select public.set_forecast_account_routing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','income','income-1','{"deposit_account_ref":"bank:00000000-0000-4000-8000-000000000003"}','{"deposit_account_ref":"bank:00000000-0000-4000-8000-000000000003"}');
select test.assert((select deposit_account_ref='bank:00000000-0000-4000-8000-000000000008' from incomes where id='income-1'),'routing old inactive alias stores current canonical bank ref');
do $$declare before_row jsonb; saved jsonb; retry jsonb;begin
 select to_jsonb(p) into before_row from public.account_forecast_preferences p where account_ref='bank:00000000-0000-4000-8000-000000000003';
 saved:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',(before_row->>'updated_at')::timestamptz,'{"safety_floor":150}');
 perform test.assert(saved->>'account_ref'='bank:00000000-0000-4000-8000-000000000008' and saved->'savings_apy'='null'::jsonb and (saved->>'safety_floor')::numeric=150,'old bank preference revision moves key and preserves omitted APY');
 perform test.assert((select count(*)=1 from account_forecast_preferences where account_ref in ('bank:00000000-0000-4000-8000-000000000003','bank:00000000-0000-4000-8000-000000000008')) and not exists(select 1 from account_forecast_preferences where account_ref='bank:00000000-0000-4000-8000-000000000003'),'preference move leaves one current canonical row');
 retry:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',(before_row->>'updated_at')::timestamptz,'{"safety_floor":150}');
 perform test.assert(saved=retry,'preference retry after canonical key move is idempotent');
 perform test.must_fail(format('select public.set_account_forecast_preferences(%L,%L,%L::timestamptz,%L::jsonb)','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',before_row->>'updated_at','{"safety_floor":200}'),'old preference revision cannot overwrite canonical moved settings','changed');
end$$;
reset role;
-- Both active rows are one physical identity; the newest active row wins.
insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,persistent_account_id,updated_at)
values('00000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-9','FAKE Savings newest','depository','savings','depository','savings',2000,2000,true,'USD','FAKE-SAVINGS-PERSISTENT','2026-03-01');
set role authenticated;
select test.assert((private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-savings')->>'ref')='bank:00000000-0000-4000-8000-000000000009','same persistent identity allows multiple active aliases and chooses newest');
reset role;
-- A different physical identity claiming the same bridge remains a conflict.
insert into public.plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,persistent_account_id,account_id,updated_at)
values('00000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','fake-provider-10','FAKE Distinct Savings','depository','savings','depository','savings',800,800,true,'USD','FAKE-DIFFERENT-PERSISTENT','manual-savings','2026-03-02');
set role authenticated;
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-savings')$q$,'different physical identities cannot share one manual bridge','conflicting bank links');
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000003')$q$,'bank alias detects distinct physical bridge collision','conflicting bank links');
reset role;
update plaid_accounts set account_id=null where id='00000000-0000-4000-8000-000000000010';
update plaid_accounts set account_subtype='checking',subtype='checking' where id='00000000-0000-4000-8000-000000000008';
set role authenticated;
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000009')$q$,'persistent peers with conflicting cash type fail honestly','invalid bank link');
reset role;
update plaid_accounts set account_subtype='savings',subtype='savings',currency_code='EUR' where id='00000000-0000-4000-8000-000000000008';
set role authenticated;
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000009')$q$,'persistent peer currency disagreement blocks whole physical group','USD account');
reset role;
update plaid_accounts set currency_code='USD',flowledger_account_id='manual-checking' where id='00000000-0000-4000-8000-000000000008';
set role authenticated;
select test.must_fail($q$select private.forecast_account_details('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000009')$q$,'persistent peers with different manual bridges reject','conflicting bank links');
reset role;
update plaid_accounts set flowledger_account_id=null where id='00000000-0000-4000-8000-000000000008';
-- A preexisting manual-alias preference also migrates with its own CAS revision.
delete from account_forecast_preferences where household_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into account_forecast_preferences(household_id,account_ref,savings_apy,safety_floor,updated_at) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','manual:manual-savings',4,30,'2026-01-10T00:00:00Z');
set role authenticated;
do $$declare saved jsonb;retry jsonb;begin
 saved:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','manual:manual-savings','2026-01-10T00:00:00Z','{"safety_floor":40}');
 perform test.assert(saved->>'account_ref'='bank:00000000-0000-4000-8000-000000000009' and (saved->>'savings_apy')::numeric=4 and (saved->>'safety_floor')::numeric=40,'manual-alias preference moves to active representative preserving APY');
 retry:=public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','manual:manual-savings','2026-01-10T00:00:00Z','{"safety_floor":40}');
 perform test.assert(saved=retry and (select count(*)=1 from account_forecast_preferences),'manual-alias canonical key move retry remains one row');
end$$;
reset role;

-- Revoke an editor after one successful save and prove future reads/writes
-- immediately stop without relying on stale client membership data.
delete from public.household_members where user_id='22222222-2222-4222-8222-222222222222';
set role authenticated;
select test.must_fail($q$select public.get_household_forecast_accounts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$q$,'membership revocation stops catalog reads immediately','access required');
select test.must_fail($q$select public.set_account_forecast_preferences('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank:00000000-0000-4000-8000-000000000003',null,'{"savings_apy":5}')$q$,'membership revocation stops writes immediately','edit access');
select test.assert((select count(*)=0 from account_forecast_preferences),'membership revocation stops preference table reads');
reset role;
select 'ACCOUNT FORECAST DATABASE TESTS COMPLETE' as result;
