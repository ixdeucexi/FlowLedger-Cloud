\set ON_ERROR_STOP on
create table public.fixture_assertions(label text primary key);
create function public.assert_true(ok boolean,label text) returns void language plpgsql security definer set search_path='' as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; insert into public.fixture_assertions values(label) on conflict do nothing; end$$;
create function public.assert_rejected(statement text,label text) returns void language plpgsql as $$begin begin execute statement; exception when others then perform public.assert_true(true,label); return; end; raise exception 'FAIL accepted: %',label; end$$;
insert into public.household_members values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','viewer'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','owner');
insert into public.household_plans values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','free'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pro');
insert into private.release_feature_entitlements values('review_center',true);
insert into public.accounts values('checking','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'checking'),('foreign-account','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,'checking'),('inactive','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false,'checking');
insert into public.plaid_accounts(id,household_id,plaid_account_id,account_type,account_subtype) values
 ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank-checking','depository','checking'),
 ('aaaaaaaa-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bank-credit','credit','credit card');
insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,current_amount,target_date,goal_type,created_at) values
 ('bucket','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Trip',1000,0,'2026-11-20','planned_expense','2026-10-01'),
 ('foreign','33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-000000000001','Other',1000,0,'2026-11-20','planned_expense','2026-10-01'),
 ('savings','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Savings',1000,0,'2026-11-20','savings','2026-10-01');
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,plaid_account_id) values
 ('bank','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-100,'Shopping','Bank purchase','plaid','needs_review','bank-checking'),
 ('manual','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-50,'Shopping','Manual purchase','manual','legacy_reviewed',null),
 ('foreign-tx','33333333-3333-4333-8333-333333333333','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-000000000001','2026-10-26',-10,'Shopping','Other','manual','legacy_reviewed',null),
 ('credit','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-10,'Shopping','Credit','plaid','needs_review','bank-credit'),
 ('other-budget','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000099','2026-10-26',-10,'Shopping','Other budget','manual','legacy_reviewed',null);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
select public.add_bucket_purchase('bucket','bank',100,'2026-10-26');
select public.assert_true((select current_amount=100 from public.goals where id='bucket'),'bank purchase allocated once');
select public.add_bucket_purchase('bucket','bank',100,'2026-10-26');
select public.assert_true((select current_amount=100 from public.goals where id='bucket'),'bank identical retry no extra allocation');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','bank',101,'2026-10-26')$q$,'conflicting retry rejected');
select public.add_bucket_purchase('bucket','manual',50,'2026-10-26');
select public.assert_true((select current_amount=150 from public.goals where id='bucket'),'manual purchase adds to prior bank purchase');
select public.add_bucket_purchase('bucket','new',75,'2026-10-26','{"amount":-75,"date":"2026-10-26","category":"Food","note":"New purchase","account_id":"checking"}');
select public.add_bucket_purchase('bucket','new',75,'2026-10-26','{"amount":-75,"date":"2026-10-26","category":"Food","note":"New purchase","account_id":"checking"}');
select public.assert_true((select current_amount=225 from public.goals where id='bucket'),'new purchase and retry total correct');
select public.assert_true((select count(*)=1 from public.transactions where id='new'),'new purchase stable id has one cash row');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','over',2000,'2026-10-26','{"amount":-2000,"date":"2026-10-26","category":"Food"}')$q$,'overbudget rejected');
select public.assert_true(not exists(select 1 from public.transactions where id='over'),'overbudget creates no orphan cash row');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','foreign-tx',10,'2026-10-26')$q$,'cross household rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('foreign','manual',50,'2026-10-26')$q$,'foreign bucket rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','other-budget',10,'2026-10-26')$q$,'cross budget rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','credit',10,'2026-10-26')$q$,'nonchecking bank charge rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('savings','credit',10,'2026-10-26')$q$,'savings target rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','invalid',10,'2026-10-26','{"amount":-10,"date":"2026-10-26","category":"Food","account_id":"foreign-account"}')$q$,'foreign account rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','invalid',10,'2026-10-26','{"amount":-10,"date":"2026-10-26","category":"Food","account_id":"inactive"}')$q$,'inactive account rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','invalid',10,'2026-10-26','{"amount":-11,"date":"2026-10-26","category":"Food"}')$q$,'mismatched new amount rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','invalid',10,'2026-02-30','{"amount":-10,"date":"2026-02-30","category":"Food"}')$q$,'invalid date rejected');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','invalid','NaN','2026-10-26')$q$,'nonfinite amount rejected');
select public.assert_rejected($q$update public.transactions set amount=-51 where id='manual'$q$,'direct client amount edit blocked');
select public.update_bucket_purchase('manual','bucket',-50,'{"amount":-60,"date":"2026-10-27","category":"Food","note":"Edited","account_id":"checking"}');
select public.update_bucket_purchase('manual','bucket',-50,'{"amount":-60,"date":"2026-10-27","category":"Food","note":"Edited","account_id":"checking"}');
select public.assert_true((select current_amount=235 from public.goals where id='bucket'),'manual edit and retry apply delta once');
select public.assert_rejected($q$select public.update_bucket_purchase('manual','bucket',-50,'{"amount":-61,"date":"2026-10-27","category":"Food","note":"Stale"}')$q$,'stale edit rejected');
select public.undo_bucket_purchase('bank','bucket');
select public.assert_true((select current_amount=135 from public.goals where id='bucket'),'undo oldest bank preserves later manual and new purchases');
select public.assert_true((select amount=-100 and linked_plan_id is null from public.transactions where id='bank'),'remove allocation retains cash transaction');
select public.undo_bucket_purchase('bank','bucket');
select public.assert_true((select current_amount=135 from public.goals where id='bucket'),'undo retry no second subtraction');
reset role;
-- Existing exact matches followed by a budget increase use actual spending.
update public.goals set target_amount=135 where id='bucket';
update public.transaction_reconciliations set settlement='exact',allocations=jsonb_set(allocations,'{0,settlement}','"exact"') where transaction_id='new';
update public.goals set target_amount=300 where id='bucket';
set role authenticated;
select public.add_bucket_purchase('bucket','bank',100,'2026-10-26');
select public.assert_true((select current_amount=235 from public.goals where id='bucket'),'historical exact does not fill increased budget');
select public.update_bucket_budget('bucket','Trip',400,'2026-11-20','{"name":"Trip","target_amount":300,"target_date":"2026-11-20"}');
select public.assert_true((select current_amount=235 and target_amount=400 from public.goals where id='bucket'),'budget adjustment preserves authoritative spent');
select public.assert_rejected($q$select public.update_bucket_budget('bucket','Trip',100,'2026-11-20','{"name":"Trip","target_amount":400,"target_date":"2026-11-20"}')$q$,'budget cannot shrink below spent');
select public.assert_rejected($q$select public.update_bucket_budget('bucket','Trip',500,'2026-11-20','{"name":"Trip","target_amount":300,"target_date":"2026-11-20"}')$q$,'stale budget edit rejected');
select public.delete_bucket_purchase('new','bucket');
select public.delete_bucket_purchase('new','bucket');
select public.assert_true((select current_amount=160 from public.goals where id='bucket'),'delete and retry remove only own allocation');
select public.assert_true((select deleted_at is not null and linked_plan_id is null from public.transactions where id='new'),'delete unmatches and soft deletes atomically');
reset role;
update public.goals set closed_at=now() where id='bucket';
set role authenticated;
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','closed-new',10,'2026-10-26','{"amount":-10,"date":"2026-10-26","category":"Food"}')$q$,'closed bucket rejects new purchase');
select public.assert_rejected($q$select public.undo_bucket_purchase('manual','bucket')$q$,'closed bucket requires reopen before removal');
reset role;
update public.goals set closed_at=null,archived_at=now() where id='bucket';
set role authenticated;
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','archived-new',10,'2026-10-26','{"amount":-10,"date":"2026-10-26","category":"Food"}')$q$,'archived bucket rejects purchase');
reset role;
update public.goals set archived_at=null where id='bucket';
-- Viewer and foreign owners cannot mutate these targets.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
select public.assert_rejected($q$select public.undo_bucket_purchase('manual','bucket')$q$,'viewer cannot remove purchase');
select public.assert_rejected($q$select public.add_bucket_purchase('bucket','viewer-new',10,'2026-10-26','{"amount":-10,"date":"2026-10-26","category":"Food"}')$q$,'viewer cannot record purchase');
select public.assert_true((select current_amount=160 from public.goals where id='bucket'),'viewer can read household bucket');
reset role;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
set role authenticated;
select public.assert_true(not exists(select 1 from public.goals where id='bucket'),'foreign owner cannot read bucket');
select public.assert_rejected($q$select public.undo_bucket_purchase('manual','bucket')$q$,'foreign owner cannot remove purchase');
reset role;
select public.assert_true(not has_function_privilege('anon','public.add_bucket_purchase(text,text,numeric,date,jsonb)','execute'),'anonymous cannot invoke add RPC');
select public.assert_true(not has_function_privilege('anon','private.add_bucket_purchase(text,text,numeric,date,jsonb)','execute'),'anonymous cannot invoke definer');
select public.assert_true(not has_function_privilege('authenticated','private.guard_bucket_purchase_edit()','execute'),'client cannot invoke trigger');
-- Posted replacement preserves one allocation; repeated undo restores original.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
update public.transactions set review_status='needs_review' where id='bank';
-- Unassign bank to make it available; manual stays in bucket.
set role authenticated;
select public.undo_bucket_purchase('bank','bucket');
reset role;
update public.transactions set amount=-65,date='2026-10-28',review_status='needs_review' where id='bank';
set role authenticated;
select public.replace_bucket_purchase('bank','manual',60,65,'2026-10-28');
select public.replace_bucket_purchase('bank','manual',60,65,'2026-10-28');
select public.assert_true((select current_amount=65 from public.goals where id='bucket'),'replacement variance changes allocation only once');
select public.assert_true((select removed_at is not null from public.transactions where id='manual'),'replacement hides manual cash representation');
select public.assert_true((select linked_plan_id='bucket' and review_resolution='goal' and amount=-65 from public.transactions where id='bank'),'posted bank owns bucket allocation');
select public.undo_bucket_purchase('bank','bucket');
select public.assert_true((select current_amount=60 from public.goals where id='bucket'),'replacement undo restores manual allocated amount');
select public.assert_true((select removed_at is null and review_status='matched' from public.transactions where id='manual'),'replacement undo restores manual purchase');
select public.assert_true((select review_status='needs_review' and linked_plan_id is null from public.transactions where id='bank'),'replacement undo restores bank review state');
reset role;
select public.assert_true((select count(*)=1 from public.transaction_reconciliations where target_id='bucket'),'only restored manual owns the allocation');
select count(*) as assertions_passed from public.fixture_assertions;
-- A pending link made before bucket assignment remains valid across posting.
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,plaid_account_id,plaid_transaction_id) values
 ('pending-manual','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-31',-40,'Food','Pending purchase','manual','legacy_reviewed',null,null),
 ('pending-bank','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-11-01',-45,'Food','Posted purchase','plaid','needs_review','bank-checking','posted-provider');
insert into public.pending_plan_matches(id,household_id,budget_id,target_type,target_id,status,pending_plaid_transaction_id)
 values('pending-link','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','manual','pending-manual','active','pending-provider');
set role authenticated;
select public.add_bucket_purchase('bucket','pending-manual',40,'2026-10-31');
reset role;
select public.assert_true((select status='active' from public.pending_plan_matches where id='pending-link'),'bucket attach preserves existing active pending link');
-- This is the service-role update performed by api/_utils/sync.js on posting.
update public.pending_plan_matches set status='ready_review',posted_transaction_id='pending-bank',posted_plaid_transaction_id='posted-provider',posted_amount=45 where pending_plaid_transaction_id='pending-provider' and status='active';
set role authenticated;
select public.replace_bucket_purchase('pending-bank','pending-manual',40,45,'2026-11-01');
select public.assert_true((select current_amount=105 from public.goals where id='bucket'),'explicit crossmonth posting changes only purchase variance');
reset role;
select public.assert_true((select status='completed' from public.pending_plan_matches where id='pending-link'),'posted bucket replacement completes pending link');
set role authenticated;
select public.undo_bucket_purchase('pending-bank','bucket');
select public.assert_true((select current_amount=100 from public.goals where id='bucket'),'crossmonth undo preserves both manual purchases');
reset role;
select public.assert_true((select status='ready_review' from public.pending_plan_matches where id='pending-link'),'crossmonth undo restores ready review link');
select count(*) as assertions_passed from public.fixture_assertions;

-- The old posted Review Center RPC remains compatible with new purchases.
insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,current_amount,target_date,goal_type,created_at)
 values('legacy-rpc','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Legacy',100,0,'2026-11-20','planned_expense','2026-10-01');
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,plaid_account_id) values
 ('legacy-exact','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-100,'Other','Old exact','plaid','needs_review','bank-checking'),
 ('legacy-split','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-150,'Other','Old split','plaid','needs_review','bank-checking');
set role authenticated;
select public.reconcile_transaction('legacy-exact','goal','legacy-rpc','2026-10-26',100,'exact',null);
select public.assert_true((select current_amount=100 from public.goals where id='legacy-rpc'),'actual old exact RPC counts actual cost');
select public.update_bucket_budget('legacy-rpc','Legacy',300,'2026-11-20','{"name":"Legacy","target_amount":100,"target_date":"2026-11-20"}');
select public.add_bucket_purchase('legacy-rpc','new-after-old',25,'2026-10-26','{"amount":-25,"date":"2026-10-26","category":"Other"}');
select public.assert_true((select current_amount=125 from public.goals where id='legacy-rpc'),'actual old exact RPC followed by budget increase and purchase stays actual');
select public.reconcile_transaction('legacy-split','goal','legacy-rpc','2026-10-26',50,'split','Other');
select public.assert_true((select current_amount=175 from public.goals where id='legacy-rpc'),'actual old split RPC counts only allocated portion');
select public.undo_transaction_reconciliation('legacy-exact');
select public.assert_true((select current_amount=75 from public.goals where id='legacy-rpc'),'actual old undo RPC preserves newer and split purchases');
select public.undo_bucket_purchase('legacy-split','legacy-rpc');
select public.assert_true((select current_amount=25 from public.goals where id='legacy-rpc'),'new remove action supports old split purchase');
reset role;
select count(*) as assertions_passed from public.fixture_assertions;

-- Legacy versions allowed target budgets below already recorded spending.
-- Unchanged-target lifecycle/progress repairs must not trap those rows.
insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,current_amount,target_date,goal_type,created_at,closed_at)
 values('legacy-overspent-closed','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Overspent closed',100,125,'2026-11-20','planned_expense','2026-10-01',now()),
 ('legacy-overspent-open','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Overspent open',100,125,'2026-11-20','planned_expense','2026-10-01',null);
set role authenticated;
update public.goals set closed_at=null,closed_by=null where id='legacy-overspent-closed';
select public.assert_true((select closed_at is null and current_amount=125 and target_amount=100 from public.goals where id='legacy-overspent-closed'),'legacy overspent closed bucket can reopen without changing spend');
select public.update_bucket_budget('legacy-overspent-closed','Overspent closed',150,'2026-11-20','{"name":"Overspent closed","target_amount":100,"target_date":"2026-11-20"}');
select public.assert_true((select current_amount=125 and target_amount=150 from public.goals where id='legacy-overspent-closed'),'reopened legacy overspent bucket can adjust budget');
update public.goals set closed_at=now() where id='legacy-overspent-open';
select public.assert_true((select closed_at is not null and current_amount=125 from public.goals where id='legacy-overspent-open'),'legacy overspent bucket can close with unchanged target');
update public.goals set closed_at=null where id='legacy-overspent-open';
select public.assert_rejected($q$update public.goals set target_amount=110 where id='legacy-overspent-open'$q$,'changed target still cannot underfund live spending');
select public.assert_rejected($q$update public.goals set current_amount=90 where id='legacy-overspent-open'$q$,'legacy overspent state does not bypass direct spent guard');
reset role;
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,review_resolution,linked_plan_id,linked_plan_type,review_allocations)
 values('legacy-overspent-purchase','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-25,'Food','Legacy expense','manual','matched','goal','legacy-overspent-open','goal','[{"type":"planned_expense","source":"goal","targetId":"legacy-overspent-open","amount":25,"settlement":"partial"}]');
insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,occurrence_date,settlement,planned_amount,allocations,restore_snapshot)
 select id,user_id,household_id,budget_id,'goal',linked_plan_id,date::date,'partial',25,review_allocations,'{"goalCurrentAmount":100}' from public.transactions where id='legacy-overspent-purchase';
select public.assert_true((select current_amount=125 from public.goals where id='legacy-overspent-open'),'canonical aggregate can repair unchanged overspent target');
set role authenticated;
select public.update_bucket_purchase('legacy-overspent-purchase','legacy-overspent-open',-25,'{"amount":-20,"date":"2026-10-26","category":"Food","note":"Reduced legacy expense"}');
select public.assert_true((select current_amount=120 and target_amount=100 from public.goals where id='legacy-overspent-open'),'legacy overspent purchase can decrease while still overspent');
select public.assert_rejected($q$select public.update_bucket_purchase('legacy-overspent-purchase','legacy-overspent-open',-20,'{"amount":-21,"date":"2026-10-26","category":"Food","note":"Worsen"}')$q$,'legacy overspent purchase cannot increase above budget');
select public.undo_bucket_purchase('legacy-overspent-purchase','legacy-overspent-open');
select public.assert_true((select current_amount=100 and target_amount=100 from public.goals where id='legacy-overspent-open'),'legacy overspent remove preserves original base spending');
select public.assert_true((select amount=-20 and linked_plan_id is null from public.transactions where id='legacy-overspent-purchase'),'legacy overspent remove retains reduced cash transaction');
reset role;
select count(*) as assertions_passed from public.fixture_assertions;
