\set ON_ERROR_STOP on
-- Migration itself is additive metadata behavior: no existing row changes.
do $$declare row record;actual jsonb;begin
 for row in select * from test.flow_before_rows loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',row.table_name) into actual;
  perform test.assert(actual=row.rows,'no migration backfill: '||row.table_name);
 end loop;
 perform test.assert(not exists((select * from test.flow_before_policies except select * from pg_policies where schemaname='public' and tablename in('accounts','plaid_accounts')) union all (select * from pg_policies where schemaname='public' and tablename in('accounts','plaid_accounts') except select * from test.flow_before_policies)),'existing account RLS unchanged');
end$$;
select test.assert(not has_table_privilege('authenticated','public.plaid_accounts','UPDATE'),'no broad bank UPDATE grant');
select test.assert((select prosecdef from pg_proc where oid='private.rename_forecast_account(uuid,uuid,text,text,text)'::regprocedure),'narrow private rename needs bank metadata definer');
select test.assert(not (select prosecdef from pg_proc where oid='public.rename_forecast_account(uuid,uuid,text,text,text)'::regprocedure),'public rename wrapper is invoker');
select test.assert(not (select prosecdef from pg_proc where oid='private.set_forecast_account_routing_batch(uuid,uuid,jsonb)'::regprocedure),'batch retains row RLS as invoker');
select test.assert(not has_function_privilege('anon','public.rename_forecast_account(uuid,uuid,text,text,text)','EXECUTE'),'anonymous rename privilege revoked');
select test.assert(not has_function_privilege('service_role','public.rename_forecast_account(uuid,uuid,text,text,text)','EXECUTE'),'background role cannot call user rename RPC');
select test.assert(not has_function_privilege('anon','public.set_forecast_account_routing_batch(uuid,uuid,jsonb)','EXECUTE'),'anonymous batch privilege revoked');
select test.assert((select bool_and(proconfig @> array['search_path=""']) from pg_proc where oid in('private.rename_forecast_account(uuid,uuid,text,text,text)'::regprocedure,'private.set_forecast_account_routing_batch(uuid,uuid,jsonb)'::regprocedure,'private.preserve_plaid_account_display_name()'::regprocedure)),'new functions fix empty search_path');

set role anon;
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','FAKE manual-cash','Pocket cash')$q$,'anonymous rename denied','permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','FAKE manual-cash','Pocket cash')$q$,'viewer rename denied','edit access');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[]')$q$,'viewer batch denied','edit access');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001','FAKE Checking','Mine')$q$,'foreign household rename denied','edit access');
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001','FAKE Checking','Mine')$q$,'removed member rename denied','edit access');
select set_config('request.jwt.claim.sub','',false);
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','FAKE manual-cash','Mine')$q$,'missing uid rename denied','edit access');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.must_fail($q$update public.plaid_accounts set display_name='Bypass' where id='00000000-0000-4000-8000-000000000001'$q$,'direct editor bank name write remains denied','permission denied');
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','manual:manual-cash','FAKE manual-cash','Mine')$q$,'foreign budget denied','budget in this household');
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:foreign-manual','FAKE foreign','Mine')$q$,'foreign manual ref denied','active account');
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000006','FAKE Foreign','Mine')$q$,'foreign bank ref denied','active bank account');
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000004','FAKE Credit','Mine')$q$,'credit account rename excluded from cash surface','checking or savings');
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000007','FAKE Euro Savings','Mine')$q$,'foreign currency cash rename unavailable','USD');
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000005','FAKE Inactive','Mine')$q$,'inactive cash without active alias denied','active bank account');

do $$declare before_row jsonb;before_settings jsonb;reply jsonb;begin
 select to_jsonb(a)-'name' into before_row from accounts a where id='manual-cash';
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') into before_settings from household_settings s;
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','FAKE manual-cash',E'  Pocket\t\n  cash  ');
 perform test.assert(reply->>'name'='Pocket cash' and reply->>'account_ref'='manual:manual-cash','manual name normalized and canonical ref returned');
 perform test.assert(reply->'accounts'='[{"id":"manual-cash","name":"Pocket cash"}]'::jsonb,'manual response exposes name metadata only');
 perform test.assert((select to_jsonb(a)-'name'=before_row from accounts a where id='manual-cash'),'manual name changes no balance/date/type/id/reconciliation');
 perform test.assert((select coalesce(jsonb_agg(to_jsonb(s)),'[]')=before_settings from household_settings s),'manual name triggers no starting-balance rewrite');
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','FAKE manual-cash','Pocket cash');
 perform test.assert((reply->>'retry')::boolean,'manual lost-response same-value retry succeeds');
 perform test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','FAKE manual-cash','Other cash')$q$,'stale manual name rejected','name changed');
 perform test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','Pocket cash',null)$q$,'manual reset rejected','manual account needs a name');
 perform test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','Pocket cash','   ')$q$,'empty name rejected','1 to 80');
 perform test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','Pocket cash',repeat('x',81))$q$,'overlong name rejected','1 to 80');
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash','Pocket cash',repeat('x',80));
 perform test.assert(char_length(reply->>'name')=80,'80 character name accepted');
 perform public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-cash',repeat('x',80),'Pocket cash');
end$$;

do $$declare before_row jsonb;reply jsonb;begin
 select to_jsonb(a)-'display_name' into before_row from plaid_accounts a where id='00000000-0000-4000-8000-000000000001';
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001','FAKE Checking','Everyday Checking');
 perform test.assert(reply->>'name'='Everyday Checking','non-owner editor renames shared checking account');
 perform test.assert((select a->>'display_name'='Everyday Checking' from jsonb_array_elements(reply->'bank_accounts') a where a->>'id'='00000000-0000-4000-8000-000000000001'),'returned shared catalog immediately reflects rename');
 perform test.assert((select to_jsonb(a)-'display_name'=before_row from plaid_accounts a where id='00000000-0000-4000-8000-000000000001'),'bank name changes no source/provider/raw name/mask/balance/asof');
 perform test.assert(reply::text not like '%FAKE_SECRET%' and reply::text not like '%plaid_item%' and reply::text not like '%raw%','rename response excludes credentials/control/raw');
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001','FAKE Checking','Everyday Checking');
 perform test.assert((reply->>'retry')::boolean,'bank lost-response retry succeeds');
 perform test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001','Everyday Checking · ••1234','Other')$q$,'masked label is not the CAS name','name changed');
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000001','Everyday Checking',null);
 perform test.assert(reply->>'name'='FAKE Checking' and (select display_name is null from plaid_accounts where id='00000000-0000-4000-8000-000000000001'),'reset uses bank name without changing provider identity');
 perform public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000003','FAKE Savings','Family Savings');
 perform test.assert((select display_name='Family Savings' from plaid_accounts where id='00000000-0000-4000-8000-000000000003'),'Savings uses same shared name path');
end$$;
reset role;

-- Prepare a real explicit bridge and reconnect identity; no names/masks infer it.
insert into accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('manual-bills-mirror','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Local bridge label','checking',500);
update plaid_accounts set persistent_account_id='stable-bills',flowledger_account_id='manual-bills-mirror' where id='00000000-0000-4000-8000-000000000002';
insert into plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,persistent_account_id,flowledger_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,updated_at,display_name)
values('00000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','reconnected-bills','stable-bills','manual-bills-mirror','FAKE Reconnected Bills','depository','checking','depository','checking',500,450,true,'USD','2027-01-01','Stale insertion');
select test.assert((select display_name is null from plaid_accounts where id='00000000-0000-4000-8000-000000000012'),'reconnect inherits existing explicit NULL reset over stale insertion');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$declare reply jsonb;before_rows jsonb;begin
 select jsonb_agg(to_jsonb(a)-'display_name' order by a.id) into before_rows from plaid_accounts a where persistent_account_id='stable-bills';
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000002','FAKE Reconnected Bills','Shared Bills');
 perform test.assert(reply->>'account_ref'='bank:00000000-0000-4000-8000-000000000012','old bank alias resolves current active canonical account');
 perform test.assert((select bool_and(display_name='Shared Bills') from plaid_accounts where persistent_account_id='stable-bills'),'all explicit physical bank aliases renamed atomically');
 perform test.assert((select jsonb_agg(to_jsonb(a)-'display_name' order by a.id)=before_rows from plaid_accounts a where persistent_account_id='stable-bills'),'alias name synchronization changes no observation or financial fields');
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-bills-mirror','Shared Bills','Household Bills');
 perform test.assert(reply->>'account_ref'='bank:00000000-0000-4000-8000-000000000012' and reply->>'name'='Household Bills','explicit manual bridge renames canonical physical bank');
 perform test.assert((select name='Household Bills' from accounts where id='manual-bills-mirror'),'bank bridge synchronizes explicit manual fallback name only');
 perform test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-bills-mirror','Local bridge label','Third name')$q$,'bridge expected name uses canonical bank precedence','name changed');
 perform public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-bills-mirror','Household Bills',null);
end$$;
reset role;

-- Reproduce the actual stale sync index/upsert race, including equal-date retry.
update plaid_accounts set updated_at='2028-01-01',current_balance=510,available_balance=460,display_name='STALE PRE-READ' where id='00000000-0000-4000-8000-000000000002';
select test.assert((select display_name is null and current_balance=510 and available_balance=460 and updated_at='2028-01-01' from plaid_accounts where id='00000000-0000-4000-8000-000000000002'),'provider refresh preserves reset while updating legitimate observation');
update plaid_accounts set updated_at=updated_at,display_name='STALE SAME-DATE RETRY' where id='00000000-0000-4000-8000-000000000002';
select test.assert((select display_name is null from plaid_accounts where id='00000000-0000-4000-8000-000000000002'),'same observation retry cannot resurrect reset custom name');
insert into plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,persistent_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,updated_at,display_name)
values('00000000-0000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','third-bills','stable-bills','FAKE New Bills','depository','checking','depository','checking',510,460,true,'USD','2029-01-01','STALE PRE-READ');
select test.assert((select display_name is null from plaid_accounts where id='00000000-0000-4000-8000-000000000013'),'new exact persistent reconnect also respects reset');
insert into plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,persistent_account_id,name,mask,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,display_name)
values('00000000-0000-4000-8000-000000000014','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','distinct-bills','different-physical','FAKE New Bills','1234','depository','checking','depository','checking',20,20,true,'USD','STALE PRE-READ');
select test.assert((select display_name is null from plaid_accounts where id='00000000-0000-4000-8000-000000000014'),'new unproven account receives no inferred nickname');

-- Explicit bridge lifecycle: inactive bank fallback and later reconnect keep
-- the user's current name, while all money/observation fields stay unchanged.
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000013','FAKE New Bills','Before offline');
select test.assert((select name='Before offline' from accounts where id='manual-bills-mirror'),'bank name is also the valid manual fallback name');
reset role;
update plaid_accounts set is_active=false where persistent_account_id='stable-bills';
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$declare before_local jsonb;before_bank jsonb;reply jsonb;begin
 select to_jsonb(a)-'name' into before_local from accounts a where id='manual-bills-mirror';
 select jsonb_agg(to_jsonb(a)-'display_name' order by a.id) into before_bank from plaid_accounts a where persistent_account_id='stable-bills';
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-bills-mirror','Before offline','Offline Bills');
 perform test.assert(reply->>'account_ref'='manual:manual-bills-mirror' and reply->'accounts'='[{"id":"manual-bills-mirror","name":"Offline Bills"}]'::jsonb,'inactive explicit bank lineage can rename its current manual fallback');
 perform test.assert((select bool_and(display_name='Offline Bills' and not is_active) from plaid_accounts where persistent_account_id='stable-bills'),'manual fallback synchronizes the unique inactive physical bank override without activating it');
 perform test.assert((select to_jsonb(a)-'name'=before_local from accounts a where id='manual-bills-mirror'),'manual fallback rename changes no financial observation');
 perform test.assert((select jsonb_agg(to_jsonb(a)-'display_name' order by a.id)=before_bank from plaid_accounts a where persistent_account_id='stable-bills'),'inactive alias rename changes only display metadata');
end$$;
reset role;
update plaid_accounts set is_active=true,updated_at='2030-01-01',display_name='STALE BEFORE DISCONNECT' where id='00000000-0000-4000-8000-000000000013';
select test.assert((select display_name='Offline Bills' and updated_at='2030-01-01' from plaid_accounts where id='00000000-0000-4000-8000-000000000013'),'reconnecting the same identity preserves the manual fallback rename');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$declare reply jsonb;begin
 reply:=public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bank:00000000-0000-4000-8000-000000000013','Offline Bills',null);
 perform test.assert(reply->>'name'='FAKE New Bills' and reply->'accounts'='[{"id":"manual-bills-mirror","name":"FAKE New Bills"}]'::jsonb,'reset returns and persists effective bank name for the explicit manual fallback');
 perform test.assert((select name='FAKE New Bills' from accounts where id='manual-bills-mirror') and (select bool_and(display_name is null) from plaid_accounts where persistent_account_id='stable-bills'),'reset keeps both representations coherent');
 perform test.assert((select updated_at='2030-01-01' and current_balance=510 from plaid_accounts where id='00000000-0000-4000-8000-000000000013'),'reset does not bump the bank observation');
end$$;
reset role;
update plaid_accounts set is_active=false where persistent_account_id='stable-bills';
update plaid_accounts set is_active=false,flowledger_account_id='manual-bills-mirror' where id='00000000-0000-4000-8000-000000000014';
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.must_fail($q$select public.rename_forecast_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','manual:manual-bills-mirror','FAKE New Bills','Do not guess')$q$,'ambiguous inactive physical bridge cannot be renamed by guessing','conflicting bank links');
select test.assert((select name='FAKE New Bills' from accounts where id='manual-bills-mirror'),'ambiguous lineage leaves the current fallback unchanged');
reset role;
update plaid_accounts set flowledger_account_id=null,is_active=true where id='00000000-0000-4000-8000-000000000014';
update plaid_accounts set is_active=true where id='00000000-0000-4000-8000-000000000013';

-- Canonical future-plan setup uses current row scope/CAS in one transaction.
insert into decisions(id,user_id,household_id,budget_id,name,decision_type,scenario,result,status) values
 ('decision-active','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE recurring','recurring_bill','{"type":"recurring_bill","name":"FAKE recurring","amount":30,"date":"2027-01-01"}','{}','planned'),
 ('decision-contribution','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE savings transfer','savings_contribution','{"type":"savings_contribution","name":"FAKE savings transfer","amount":30,"date":"2027-01-01"}','{}','planned'),
 ('decision-ended','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','FAKE cancelled','recurring_bill','{"type":"recurring_bill","name":"FAKE cancelled","amount":30,"date":"2027-01-01"}','{}','cancelled');
insert into extra_payments(id,user_id,household_id,budget_id,month,year,amount,allocations) values('extra-active','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',0,2027,20,'[]');
create table test.batch_financial_before as select 'bills' table_name,id,to_jsonb(b)-'funding_account_ref' row from bills b
 union all select 'incomes',id,to_jsonb(i)-'deposit_account_ref' from incomes i
 union all select 'goals',id,to_jsonb(g)-'funding_account_ref'-'deposit_account_ref' from goals g
 union all select 'decisions',id,to_jsonb(d)-'funding_account_ref'-'deposit_account_ref' from decisions d
 union all select 'extra_payments',id,to_jsonb(e)-'funding_account_ref' from extra_payments e;
create table test.batch_changes as select '[
 {"entity_type":"income","entity_id":"income-1","expected":{"deposit_account_ref":null},"patch":{"deposit_account_ref":"bank:00000000-0000-4000-8000-000000000001"}},
 {"entity_type":"bill","entity_id":"bill-1","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000013"}},
 {"entity_type":"goal","entity_id":"bucket-1","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}},
 {"entity_type":"decision","entity_id":"decision-active","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}},
 {"entity_type":"extra_payment","entity_id":"extra-active","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}}
]'::jsonb changes;
grant select on test.batch_changes to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
do $$declare reply jsonb;begin
 reply:=public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(select changes from test.batch_changes));
 perform test.assert(jsonb_array_length(reply->'results')=5,'reviewed mixed plan batch returns every verified row');
 perform test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000013' from bills where id='bill-1') and (select deposit_account_ref='bank:00000000-0000-4000-8000-000000000001' from incomes where id='income-1'),'bill payer and income deposit assigned independently');
 reply:=public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(select changes from test.batch_changes));
 perform test.assert(jsonb_array_length(reply->'results')=5,'identical lost-response batch retry succeeds');
end$$;
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[]')$q$,'empty batch denied','1 to 100');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','{}')$q$,'non-array batch denied','1 to 100');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(select jsonb_agg(jsonb_build_object('entity_type','bill','entity_id','bulk-'||n,'expected',jsonb_build_object('funding_account_ref',null),'patch',jsonb_build_object('funding_account_ref',null))) from generate_series(1,101)n))$q$,'oversized batch denied','1 to 100');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',(select jsonb_build_array(changes->0,changes->0) from test.batch_changes))$q$,'duplicate plan denied','only once');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"transaction","entity_id":"manual-1","expected":{"forecast_account_ref":null},"patch":{"forecast_account_ref":null}}]')$q$,'actual transaction batch denied','plans only');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"bill","entity_id":"bill-1","expected":{"amount":100},"patch":{"amount":999}}]')$q$,'financial amount patch denied','Unsupported');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"bill","entity_id":"bill-1","expected":{},"patch":{"funding_account_ref":null}}]')$q$,'missing expected field denied','missing expected');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"bill","entity_id":"bill-1","expected":{"funding_account_ref":null,"amount":100},"patch":{"funding_account_ref":null}}]')$q$,'ignored expected field denied','Unexpected expected');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"bill","entity_id":"bill-1","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":true}}]')$q$,'wrong account value type denied','Unsupported');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"goal","entity_id":"bucket-1","expected":{"funding_account_ref":null,"deposit_account_ref":null},"patch":{"funding_account_ref":null,"deposit_account_ref":null}}]')$q$,'two-field batch denied','one payment or deposit');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"decision","entity_id":"decision-contribution","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":null}}]')$q$,'Savings contribution batch denied','single-account');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"decision","entity_id":"decision-ended","expected":{"funding_account_ref":null},"patch":{"funding_account_ref":null}}]')$q$,'cancelled decision batch denied','single-account');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"goal","entity_id":"savings-goal","expected":{"deposit_account_ref":null},"patch":{"deposit_account_ref":null}}]')$q$,'Savings milestone is not a cash batch plan','open spending plans');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',(select changes from test.batch_changes))$q$,'foreign batch budget denied','budget in this household');
-- First sorted bill would change successfully; the later income's stale value
-- must roll it back, proving there is no partial setup publication.
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[
 {"entity_type":"bill","entity_id":"bill-1","expected":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000013"},"patch":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000001"}},
 {"entity_type":"income","entity_id":"income-1","expected":{"deposit_account_ref":null},"patch":{"deposit_account_ref":"bank:00000000-0000-4000-8000-000000000003"}}
]')$q$,'stale later row rolls back whole batch','assignment changed');
select test.assert((select funding_account_ref='bank:00000000-0000-4000-8000-000000000013' from bills where id='bill-1'),'failed batch leaves earlier row untouched');
select test.must_fail($q$select public.set_forecast_account_routing_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','[{"entity_type":"bill","entity_id":"bill-1","expected":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000013"},"patch":{"funding_account_ref":"bank:00000000-0000-4000-8000-000000000006"}}]')$q$,'foreign target rolls back whole batch','active bank account');
reset role;
do $$declare row record;actual jsonb;begin
 for row in select * from test.batch_financial_before loop
  execute format('select to_jsonb(t)-''funding_account_ref''-''deposit_account_ref'' from public.%I t where id=$1',row.table_name) into actual using row.id;
  perform test.assert(actual=row.row,'batch changes no plan amount/history/status: '||row.table_name||'/'||row.id);
 end loop;
end$$;

-- Separate fake identities used by two-session concurrency tests below.
insert into accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values('manual-race','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Race Cash','cash',25);
insert into plaid_accounts(id,user_id,household_id,plaid_item_record_id,plaid_account_id,persistent_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,is_active,currency_code,updated_at)
values('00000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','race-provider','race-physical','Race Bank','depository','checking','depository','checking',100,90,true,'USD','2027-01-01');
select 'ACCOUNT FLOW DATABASE TESTS COMPLETE';
