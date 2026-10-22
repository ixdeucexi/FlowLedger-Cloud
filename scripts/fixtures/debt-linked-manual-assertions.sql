-- Prepare negative eligibility rows from the same valid manual debt payment.
insert into bills values('discover','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,true,1000,0),('ordinary','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,false,1000,0),('foreign','11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',null,true,1000,0),('other-budget','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',true,1000,0);
insert into transactions(id,user_id,household_id,date,amount,category,note,linked_bill_id) values('manual','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',current_date::text,-50,'Debt','Discover manual payment','discover');
insert into transactions select (jsonb_populate_record(null::transactions,to_jsonb(t)||v.patch)).* from transactions t cross join (values
 ('{"id":"ordinary","linked_bill_id":"ordinary"}'::jsonb),('{"id":"missing","linked_bill_id":"missing"}'),('{"id":"foreign","linked_bill_id":"foreign"}'),('{"id":"budget","linked_bill_id":"other-budget"}'),
 ('{"id":"imported","import_hash":"generated"}'),('{"id":"transfer","transfer_group_id":"transfer"}'),('{"id":"pending","pending":true}'),('{"id":"deleted","deleted_at":"2026-10-01T00:00:00Z"}'),('{"id":"removed","removed_at":"2026-10-01T00:00:00Z"}'),('{"id":"matched","review_status":"matched"}'),('{"id":"plan","linked_plan_id":"plan"}'),('{"id":"bank-source","source":"plaid"}'),('{"id":"statement","source":"statement"}'),('{"id":"snowball","source":"snowball_plan"}'),('{"id":"category-transfer","category":"Transfer"}'),('{"id":"positive","amount":50}'),('{"id":"foreign-manual","household_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}'),('{"id":"foreign-budget-manual","budget_id":"cccccccc-cccc-cccc-cccc-cccccccccccc"}')
 ) v(patch) where t.id='manual';
insert into transactions select (jsonb_populate_record(null::transactions,to_jsonb(t)||jsonb_build_object('id','prior-month','date',(current_date-interval '1 month')::date::text))).* from transactions t where id='manual';
insert into transactions(id,user_id,household_id,date,amount,category,note,source,review_status) values('bank','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',current_date::text,-50,'Debt','Original bank note','plaid','needs_review');
insert into plaid_transactions values('pending','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true,null);
set role authenticated;
-- Actual RLS rejection, not a source-text assertion.
do $$declare target text;begin
 foreach target in array array['ordinary','missing','foreign','budget','imported','transfer','pending','deleted','removed','matched','plan','bank-source','statement','snowball','category-transfer','positive','prior-month','foreign-manual','foreign-budget-manual'] loop
  perform public.assert_rejected(format('insert into pending_plan_matches values(%L,auth.uid(),auth.uid(),%L,null,''manual'',%L,''pending'',current_date,''active'')',target,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',target),'RLS '||target);
  perform public.assert_rejected(format('select public.reconcile_manual_transaction(''bank'',%L,current_date,50,''exact'')',target),'RPC '||target);
 end loop;
end$$;
select assert_rejected('update transactions set review_resolution=''manual'',linked_plan_id=''ordinary'' where id=''bank''','metadata trigger rejects direct nondebt link bypass');
-- Pro-editor insertion/update and cancellation both retain their prior gates.
insert into pending_plan_matches values('valid',auth.uid(),auth.uid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,'manual','manual','pending',current_date,'active');
select assert_true((select balance=1000 from bills where id='discover'),'pending link never changes debt balance');
select assert_rejected('update pending_plan_matches set target_id=''ordinary'' where id=''valid''','update rejects ordinary linked bill');
update pending_plan_matches set status='cancelled' where id='valid';
select assert_true((select status='cancelled' from pending_plan_matches where id='valid'),'cancellation allowed');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select assert_rejected('insert into pending_plan_matches values(''viewer'',auth.uid(),auth.uid(),''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'',null,''manual'',''manual'',''pending'',current_date,''active'')','viewer cannot match');
select assert_rejected('select public.reconcile_manual_transaction(''bank'',''manual'',current_date,50,''exact'')','viewer cannot reconcile');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
reset role;
-- Original applied bank audit must not disappear under a manual audit.
update transactions set debt_applied_bill_id='discover',debt_applied_amount=5 where id='bank';
set role authenticated;
select assert_rejected('select public.reconcile_manual_transaction(''bank'',''manual'',current_date,50,''exact'')','bank applied audit conflict');
select assert_true((select debt_applied_amount=5 from transactions where id='bank'),'conflicting applied audit preserved');
reset role;
update transactions set debt_applied_bill_id=null,debt_applied_amount=0 where id='bank';
delete from transactions where id not in ('manual','bank');
-- Exact, partial, overage, future manual date: no duplicate deduction and undo
-- returns ownership of CURRENT audit so existing sync computes the right delta.
set role authenticated;
do $$declare actual numeric; future boolean; expected numeric; result jsonb;begin
 for actual,future in values (50::numeric,false),(40,false),(60,false),(50,true) loop
  update bills set balance=1000 where id='discover';
  update transactions set date=(case when future then current_date+1 else current_date end)::text, removed_at=null,debt_applied_bill_id=null,debt_applied_amount=0 where id='manual';
  update transactions set amount=-actual where id='bank';
  perform public.sync_due_debt_transactions(current_date,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  expected:=case when future then 1000 else 950 end;
  perform assert_true((select balance=expected from bills where id='discover'),'manual initial application');
  perform public.reconcile_manual_transaction('bank','manual',current_date,50,case when actual=50 then 'exact' when actual<50 then 'partial' else 'full' end);
  perform assert_true((select balance=expected from bills where id='discover'),'matching itself transfers metadata without changing balance');
  perform assert_true((select linked_bill_id='discover' and linked_plan_id='manual' and review_resolution='manual' from transactions where id='bank'),'bank owns debt link without bill review state');
  perform assert_true((select removed_at is not null from transactions where id='manual'),'manual hidden while matched');
  perform public.sync_due_debt_transactions(current_date,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform assert_true((select balance=1000-actual from bills where id='discover'),'canonical sync applies posted delta once');
  result:=public.sync_due_debt_transactions(current_date,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform assert_true((result->>'changed')::boolean=false,'repeated sync is idempotent');
  perform public.undo_manual_transaction_reconciliation('bank');
  perform assert_true((select linked_bill_id is null and debt_applied_amount=0 and debt_applied_bill_id is null and note='Original bank note' from transactions where id='bank'),'undo restores original bank metadata');
  perform assert_true((select removed_at is null and debt_applied_amount=actual from transactions where id='manual'),'undo hands current audit back to original manual');
  perform public.sync_due_debt_transactions(current_date,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform assert_true((select balance=expected from bills where id='discover'),'undo plus canonical sync restores original manual payment');
  result:=public.sync_due_debt_transactions(current_date,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  perform assert_true((result->>'changed')::boolean=false,'undo repeated sync idempotent');
 end loop;
end$$;
reset role;
-- Unapplied bank link and note survive replacement and undo; the snapshot is
-- also backward-compatible with older allocations lacking linkedBillId.
update transactions set linked_bill_id='ordinary' where id='bank';
set role authenticated;
select public.reconcile_manual_transaction('bank','manual',current_date,50,'exact');
select public.undo_manual_transaction_reconciliation('bank');
select assert_true((select linked_bill_id='ordinary' and note='Original bank note' from transactions where id='bank'),'bank original link and note restored');
select assert_true(not has_function_privilege('anon','private.reconcile_manual_transaction(text,text,date,numeric,text)','execute'),'anon cannot invoke private RPC');
select assert_true(has_function_privilege('authenticated','private.reconcile_manual_transaction(text,text,date,numeric,text)','execute'),'authenticated RPC grant retained');
select assert_true(not has_function_privilege('authenticated','private.transfer_manual_activity_metadata()','execute'),'trigger cannot be directly invoked by client');
reset role;
-- Older nullable-source manually-created records stay supported.
update transactions set source=null where id='manual';
-- Paid-off linked debt remains a valid historical match target.
update bills set balance=0 where id='discover';
set role authenticated;
insert into pending_plan_matches values('paid-off',auth.uid(),auth.uid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null,'manual','manual','pending',current_date,'active');
select assert_true((select count(*)=1 from pending_plan_matches where id='paid-off'),'paid-off debt remains eligible');
reset role;
select 'PASS: actual RLS/RPC/debt sync/undo exact+partial+overage+future regressions' as result;
rollback;
