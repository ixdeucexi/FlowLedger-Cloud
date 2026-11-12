\set ON_ERROR_STOP on
-- Create a complete fictional parent scope with a converted Bill and plan.
create function test.parent_source(p_h uuid,p_b uuid,p_u uuid,p_id text) returns void language plpgsql as $$
declare saved jsonb;from_ref text;to_ref text;
begin
 perform set_config('request.jwt.claim.sub',p_u::text,false);
 insert into auth.users(id) values(p_u) on conflict do nothing;
 insert into households(id,created_by,name) values(p_h,p_u,'FAKE lifecycle');
 insert into household_members(household_id,user_id,role) values(p_h,p_u,'owner');
 insert into budgets(id,household_id) values(p_b,p_h);
 insert into household_settings(household_id,budget_id,time_zone) values(p_h,p_b,'America/Chicago');
 if p_id in('cascade-hh','cascade-budget') then
  insert into public.plaid_items(id,user_id,household_id) values(p_h,p_u,p_h);
  insert into public.plaid_accounts(id,user_id,household_id,plaid_item_id,plaid_item_record_id,plaid_account_id,name,type,subtype,account_type,account_subtype,current_balance,available_balance,currency_code)
  values(p_b,p_u,p_h,p_h,p_h,p_id||'-provider-from','FAKE from','depository','checking','depository','checking',1000,1000,'USD'),
   (p_h,p_u,p_h,p_h,p_h,p_id||'-provider-to','FAKE to','depository','savings','depository','savings',200,200,'USD');
  from_ref:='bank:'||p_b::text;to_ref:='bank:'||p_h::text;
 else
  insert into accounts(id,user_id,household_id,budget_id,name,account_type,current_balance) values(p_id||'-from',p_u,p_h,p_b,'FAKE from','checking',1000),(p_id||'-to',p_u,p_h,p_b,'FAKE to','savings',200);
  from_ref:='manual:'||p_id||'-from';to_ref:='manual:'||p_id||'-to';
 end if;
 insert into bills(id,user_id,household_id,budget_id,name,amount,due_day,start_date,created_at,funding_account_ref)
 values(p_id,p_u,p_h,p_b,'FAKE lifecycle transfer',50,4,date_trunc('month',test.local_today()::timestamp)::date::text,'fixture',case when p_id in('cascade-hh','cascade-budget') then null else 'manual:'||p_id||'-from' end);
 insert into monthly_overrides(id,user_id,household_id,budget_id,bill_id,month,year,paid_amount,paid_date)
 values(p_id||'-paid',p_u,p_h,p_b,p_id,extract(month from test.local_today())::int-1,extract(year from test.local_today())::int,50,least(date_trunc('month',test.local_today()::timestamp)::date+3,test.local_today()));
 saved:=public.convert_bill_to_planned_transfer(p_h,p_b,p_id,test.expected(p_id),test.conversion_patch()||jsonb_build_object('from_account_ref',from_ref,'to_account_ref',to_ref));
 perform test.assert(saved->'transfer'->>'source_bill_id'=p_id,'lifecycle fixture genuinely converts '||p_id);
end$$;
select test.parent_source('cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-cccc-4ccc-8ccc-ccccccccccc1','77777777-7777-4777-8777-777777777777','cascade-hh');
begin;
delete from households where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
rollback;
select test.assert(exists(select 1 from households where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') and exists(select 1 from planned_account_transfers where source_bill_id='cascade-hh'),'whole household deletion rollback restores all conversion metadata');
begin;
delete from households where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
commit;
select test.assert(not exists(select 1 from planned_account_transfers where source_bill_id='cascade-hh') and (select household_id is null and budget_id is null from bills where id='cascade-hh'),'authorized whole household cascade commits with original SET NULL financial behavior');
select test.parent_source('dddddddd-dddd-4ddd-8ddd-dddddddddddd','dddddddd-dddd-4ddd-8ddd-ddddddddddd1','88888888-8888-4888-8888-888888888888','cascade-budget');
begin;
delete from budgets where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
rollback;
select test.assert(exists(select 1 from planned_account_transfers where source_bill_id='cascade-budget') and (select budget_id is not null from bills where id='cascade-budget'),'whole budget deletion rollback preserves source and link');
begin;
delete from budgets where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
commit;
select test.assert(not exists(select 1 from planned_account_transfers where source_bill_id='cascade-budget') and (select budget_id is null from bills where id='cascade-budget'),'authorized whole budget cascade commits without reactivating source');
-- Exact service-only prepare RPC: it deletes Bill rows before parent households
-- in its alphabetic FK loop. Deferred source FK permits the complete transaction.
select test.parent_source('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','99999999-9999-4999-8999-999999999999','owned-account');
select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claim.sub','',false);
set role service_role;
begin;
select public.prepare_account_deletion('99999999-9999-4999-8999-999999999999',0);
rollback;
reset role;
select test.assert(exists(select 1 from bills where id='owned-account') and exists(select 1 from planned_account_transfers where source_bill_id='owned-account') and not exists(select 1 from private.account_deletion_receipts where user_id_hash=private.account_deletion_user_hash('99999999-9999-4999-8999-999999999999')),'exact owned-account prepare rollback restores Bill, plan and receipt');
set role service_role;
select public.prepare_account_deletion('99999999-9999-4999-8999-999999999999',0);
reset role;
delete from auth.users where id='99999999-9999-4999-8999-999999999999';
select test.assert(not exists(select 1 from bills where id='owned-account') and not exists(select 1 from planned_account_transfers where source_bill_id='owned-account') and not exists(select 1 from households where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8'),'exact owned-account prepare then Auth deletion commits with no stranded conversion');
-- Departing editor in a surviving household: exact current helper transfers
-- ownership, preserves the source/plan/partial, and Auth clears created_by only.
select set_config('request.jwt.claim.role','authenticated',false);
insert into auth.users(id) values('abababab-abab-4bab-8bab-abababababab');
insert into household_members(household_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','abababab-abab-4bab-8bab-abababababab','editor');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select test.source('shared-account');
update bills set user_id='abababab-abab-4bab-8bab-abababababab' where id='shared-account';
select set_config('request.jwt.claim.sub','abababab-abab-4bab-8bab-abababababab',false);
select test.convert('shared-account');
select public.save_planned_account_transfer_occurrence('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',test.conversion_id('shared-account'),test.cutover(),1,null,jsonb_build_object('from_reflected',true,'from_balance_as_of',test.cutover()));
select set_config('request.jwt.claim.role','service_role',false);select set_config('request.jwt.claim.sub','',false);
set role service_role;
select public.prepare_account_deletion('abababab-abab-4bab-8bab-abababababab',0);
reset role;
delete from auth.users where id='abababab-abab-4bab-8bab-abababababab';
select test.assert((select user_id='11111111-1111-4111-8111-111111111111' and end_date=(test.cutover()-1)::text from bills where id='shared-account') and (select created_by is null and source_bill_id='shared-account' and amount=50 from planned_account_transfers where source_bill_id='shared-account'),'exact shared-account prepare preserves source ownership, fixed cutoff and transfer attribution');
select test.assert((select from_reflected and not to_reflected and amount_snapshot=50 from planned_account_transfer_occurrences where transfer_id=test.conversion_id('shared-account')),'shared account deletion preserves outstanding transfer side');
select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
\echo BILL CONVERSION LIFECYCLE TESTS COMPLETE
