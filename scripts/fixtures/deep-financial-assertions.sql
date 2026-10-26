\set ON_ERROR_STOP on
create table public.deep_assertions(label text primary key);
create function public.deep_assert(ok boolean,label text) returns void language plpgsql security definer set search_path='' as $$begin if ok is distinct from true then raise exception 'FAIL %',label;end if;insert into public.deep_assertions values(label);end$$;
create function public.deep_reject(statement text,label text) returns void language plpgsql as $$begin begin execute statement;exception when others then perform public.deep_assert(true,label);return;end;raise exception 'FAIL accepted %',label;end$$;
insert into public.household_members values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','viewer');
insert into public.households(id,name,created_by)values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Test','11111111-1111-4111-8111-111111111111');
insert into public.budgets(id,household_id)values('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.accounts(id,user_id,household_id,budget_id,name,account_type,is_active)values
('a','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','A','checking',true),
('b','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','B','savings',true),
('inactive','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Inactive','savings',false);
create function public.deep_transfer(groupid text,fromid text,toid text,amount numeric,expected jsonb default null,action text default 'save')returns jsonb language sql as $$select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001',groupid,fromid,toid,expected,jsonb_build_object('amount',amount,'date','2026-10-26','fromAccountId','a','toAccountId','b','fromNote','From','toNote','To'),action)$$;
create function public.deep_pair(groupid text)returns jsonb language sql as $$select jsonb_agg(jsonb_build_object('id',id,'amount',amount,'date',date,'account_id',account_id,'note',note,'category',category)order by amount)from public.transactions where transfer_group_id=groupid$$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
select public.deep_transfer('pair','from','to',100);
select public.deep_transfer('pair','from','to',100);
select public.deep_assert((select count(*)=2 and sum(amount)=0 from public.transactions where transfer_group_id='pair'),'create and retry preserve two legs and zero net');
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'));
select public.deep_assert((select min(amount)=-150 and max(amount)=150 from public.transactions where transfer_group_id='pair'),'edit changes both legs');
select public.deep_reject($q$select public.deep_transfer('pair','from','to',175,'[]')$q$,'stale expected pair fails');
select public.deep_reject($q$update public.transactions set amount=-200 where id='from'$q$,'direct half transfer edit rejected');
select public.deep_reject($q$delete from public.transactions where id='from'$q$,'direct half transfer delete rejected');
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'delete');
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'delete');
select public.deep_assert((select count(*)=2 from public.transactions where transfer_group_id='pair'and deleted_at is not null),'delete and retry move both legs');
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'restore');
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'restore');
select public.deep_assert((select count(*)=2 from public.transactions where transfer_group_id='pair'and deleted_at is null),'restore and retry recover both legs');
select public.deep_reject($q$select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','bad','badfrom','badto',null,'{"amount":50,"date":"2026-10-26","fromAccountId":"a","toAccountId":"inactive"}')$q$,'inactive destination rejected');
select public.deep_assert(not exists(select 1 from public.transactions where id='badfrom'),'invalid pair creates no orphan');
reset role;
-- Fault after the first row has been processed must roll back the whole statement.
create function public.deep_fail_second()returns trigger language plpgsql as $$begin if new.id in('fault-to','to')and new.amount in(60,180)then raise exception 'Injected second leg failure';end if;return new;end$$;
create trigger deep_fail_second before insert or update on public.transactions for each row execute function public.deep_fail_second();
set role authenticated;
select public.deep_reject($q$select public.deep_transfer('fault','fault-from','fault-to',60)$q$,'second leg insert failure rejects whole create');
select public.deep_assert(not exists(select 1 from public.transactions where transfer_group_id='fault'),'failed create leaves no first leg');
select public.deep_reject($q$select public.deep_transfer('pair','from','to',180,public.deep_pair('pair'))$q$,'second leg update failure rejects whole edit');
select public.deep_assert((select min(amount)=-150 and max(amount)=150 from public.transactions where transfer_group_id='pair'),'failed edit preserves both original amounts');
reset role;
drop trigger deep_fail_second on public.transactions;
-- Delete/restore faults cannot leave one leg on either side of the archive.
create function public.deep_fail_archive()returns trigger language plpgsql as $$begin if new.id='to'and new.deleted_at is distinct from old.deleted_at then raise exception 'Injected archive second leg failure';end if;return new;end$$;
create trigger deep_fail_archive before update on public.transactions for each row execute function public.deep_fail_archive();
set role authenticated;
select public.deep_reject($q$select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'delete')$q$,'second leg delete failure rejects whole archive');
select public.deep_assert((select count(*)=2 from public.transactions where transfer_group_id='pair'and deleted_at is null),'failed delete retains both active legs');
reset role;
drop trigger deep_fail_archive on public.transactions;
set role authenticated;
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'delete');
reset role;
create trigger deep_fail_archive before update on public.transactions for each row execute function public.deep_fail_archive();
set role authenticated;
select public.deep_reject($q$select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'restore')$q$,'second leg restore failure rejects whole restore');
select public.deep_assert((select count(*)=2 from public.transactions where transfer_group_id='pair'and deleted_at is not null),'failed restore retains both archived legs');
reset role;
drop trigger deep_fail_archive on public.transactions;
set role authenticated;
select public.deep_transfer('pair','from','to',150,public.deep_pair('pair'),'restore');
select public.deep_reject($q$select public.mutate_transfer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-0000-4000-8000-000000000001','bad-budget','bb-from','bb-to',null,'{"amount":50,"date":"2026-10-26","fromAccountId":"a","toAccountId":"b"}')$q$,'foreign or missing budget rejected');
select public.deep_reject($q$select public.deep_transfer('bad-amount','ba-from','ba-to','NaN')$q$,'nonfinite transfer amount rejected');
select public.deep_reject($q$select public.deep_transfer('pair','wrong-id','to',150)$q$,'partial or stolen pair ids rejected');
reset role;
-- Matched bill cash may be renamed but cannot diverge from its allocation.
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,review_resolution,linked_bill_id,review_allocations)
values('matched','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-100,'Food','Bill','plaid','matched','bill','bill','[{"type":"bill","targetId":"bill","amount":100}]');
set role authenticated;
select public.deep_reject($q$update public.transactions set amount=-150 where id='matched'$q$,'matched amount change requires undo');
select public.deep_reject($q$update public.transactions set date='2026-10-27'where id='matched'$q$,'matched date change requires undo');
update public.transactions set note='Renamed'where id='matched';
select public.deep_assert((select note='Renamed'and amount=-100 and(review_allocations->0->>'amount')::numeric=100 from public.transactions where id='matched'),'matched note-only edit preserves payment');
reset role;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
select public.deep_reject($q$select public.deep_transfer('viewer','vfrom','vto',50)$q$,'viewer cannot create transfer');
reset role;
select public.deep_assert(not has_function_privilege('anon','public.mutate_transfer(uuid,uuid,text,text,text,jsonb,jsonb,text)','execute'),'anonymous transfer RPC revoked');
select public.deep_assert(not has_function_privilege('authenticated','private.guard_allocated_transaction_edit()','execute'),'guard cannot be called by clients');

-- Trusted bucket RPCs still update allocations and cash atomically.
insert into public.household_plans values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','free');
insert into private.release_feature_entitlements values('review_center',true);
insert into public.goals(id,user_id,household_id,budget_id,name,target_amount,current_amount,target_date,goal_type,created_at)values('bucket','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Bucket',500,0,'2026-11-20','planned_expense','2026-10-26');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
set role authenticated;
select public.add_bucket_purchase('bucket','bucket-manual',100,'2026-10-26','{"amount":-100,"date":"2026-10-26","category":"Food"}');
select public.update_bucket_purchase('bucket-manual','bucket',-100,'{"amount":-125,"date":"2026-10-27","category":"Food","note":"Edited"}');
select public.deep_assert((select current_amount=125 from public.goals where id='bucket'),'trusted bucket amount and date edit remains atomic');
select public.deep_assert((select amount=-125 and(review_allocations->0->>'amount')::numeric=125 from public.transactions where id='bucket-manual'),'trusted bucket cash and allocation remain equal');
reset role;
-- Positive ACL/legacy callers: no SELECT grant on reconciliation ledger.
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,review_resolution,review_allocations,linked_bill_id,debt_applied_bill_id,debt_applied_amount)values
('ordinary','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-10,'Food','Ordinary','manual','legacy_reviewed',null,'[]',null,null,0),
('categorized','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-10,'Food','Categorized','manual','categorized','category','[{"type":"category","category":"Food","amount":10}]',null,null,0),
('manual-debt-pending','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-27',-50,'Debt','Manual pending','manual','legacy_reviewed',null,'[]','debt',null,0),
('manual-debt-applied','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-50,'Debt','Manual applied','manual','legacy_reviewed',null,'[]','debt','debt',50),
('only-ledger','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2026-10-26',-10,'Food','Ledger allocation','manual','legacy_reviewed',null,'[]',null,null,0);
insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,allocations,restore_snapshot)
select id,user_id,household_id,budget_id,'bill','bill','[{"type":"bill","targetId":"bill","amount":10}]','{}' from public.transactions where id='only-ledger';
set role authenticated;
select public.deep_assert(not has_table_privilege(current_user,'public.transaction_reconciliations','select'),'ordinary caller has no reconciliation ledger read grant');
update public.transactions set amount=-20,date='2026-10-27'where id='ordinary';
select public.deep_assert((select amount=-20 and date='2026-10-27'from public.transactions where id='ordinary'),'ordinary manual amount and date edit works without ledger ACL');
update public.transactions set amount=-20,date='2026-10-27'where id='categorized';
select public.deep_assert((select amount=-20 and date='2026-10-27'from public.transactions where id='categorized'),'category-only amount and date edit remains allowed');
update public.transactions set amount=-60,date='2026-10-28'where id='manual-debt-pending';
select public.deep_assert((select amount=-60 and linked_bill_id='debt'from public.transactions where id='manual-debt-pending'),'unreconciled pending manual debt edit remains allowed');
update public.transactions set amount=-60,date='2026-10-27'where id='manual-debt-applied';
select public.deep_assert((select amount=-60 and debt_applied_amount=50 from public.transactions where id='manual-debt-applied'),'unreconciled applied manual debt edit remains available to debt sync');
update public.transactions set linked_bill_id=null where id in('manual-debt-pending','manual-debt-applied');
select public.deep_assert((select count(*)=2 from public.transactions where id in('manual-debt-pending','manual-debt-applied')and linked_bill_id is null),'No debt persists explicit null for manual debt payments');
select public.deep_reject($q$update public.transactions set amount=-20 where id='only-ledger'$q$,'real financial reconciliation guard works without client metadata or ledger ACL');
select public.deep_assert(private.has_financial_transaction_reconciliation('only-ledger','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'constrained lookup recognizes owned financial ledger row');
select public.deep_assert(not private.has_financial_transaction_reconciliation('only-ledger','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'constrained lookup hides foreign scope');
reset role;

-- Exercise the actual current debt-sync and minimum-boost functions as client.
insert into public.bills(id,user_id,household_id,budget_id,name,amount,is_debt,balance,created_at)
 values('live-debt','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','Live debt',50,true,1000,'2026-10-26');
insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,source,review_status,linked_bill_id)
 values('live-manual','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','2027-01-01',-50,'Debt','Future manual','manual','legacy_reviewed','live-debt');
set role authenticated;
select public.sync_due_debt_transactions('2026-10-26','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.deep_assert((select balance=1000 from public.bills where id='live-debt'),'future manual debt payment stays unapplied');
update public.transactions set amount=-60,date='2026-10-26'where id='live-manual';
select public.sync_due_debt_transactions('2026-10-26','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.deep_assert((select balance=940 from public.bills where id='live-debt'),'manual debt date and amount edit applies correct payment');
select public.deep_assert((select debt_applied_amount=60 and debt_applied_bill_id='live-debt'from public.transactions where id='live-manual'),'manual debt sync records authoritative applied metadata');
update public.transactions set amount=-90 where id='live-manual';
select public.sync_due_debt_transactions('2026-10-26','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.sync_due_debt_transactions('2026-10-26','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.deep_assert((select balance=910 from public.bills where id='live-debt'),'already applied manual edit and repeat sync apply only delta');
update public.transactions set linked_bill_id=null where id='live-manual';
select public.sync_due_debt_transactions('2026-10-26','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.deep_assert((select balance=1000 from public.bills where id='live-debt'),'No debt restores prior applied debt balance');
select public.deep_assert((select linked_bill_id is null and debt_applied_bill_id is null and debt_applied_amount=0 from public.transactions where id='live-manual'),'No debt clears authoritative manual debt metadata');
reset role;
