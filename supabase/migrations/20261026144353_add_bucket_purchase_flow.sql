-- Bucket purchases use the existing reconciliation ledger and canonical bases.
-- No financial rows are rewritten by this migration.
CREATE OR REPLACE FUNCTION private.recompute_planned_reconciliation_target(p_target_type text, p_target_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_variable
declare
  v_base private.planned_reconciliation_bases%rowtype;
  v_total numeric := 0;
  v_count integer := 0;
  v_has_closing boolean := false;
  v_latest timestamptz;
begin
  select * into v_base
  from private.planned_reconciliation_bases
  where target_type = p_target_type and target_id = p_target_id;
  if not found then return; end if;

  select
    coalesce(sum(
      case when allocation->>'type' = 'planned_expense'
        then coalesce((allocation->>'amount')::numeric, 0)
        else 0
      end
    ), 0),
    count(distinct reconciliation.transaction_id),
    coalesce(bool_or(reconciliation.settlement in ('exact', 'full', 'split')), false),
    max(reconciliation.reviewed_at)
  into v_total, v_count, v_has_closing, v_latest
  from public.transaction_reconciliations reconciliation
  left join lateral jsonb_array_elements(reconciliation.allocations) allocation on true
  where reconciliation.resolution = p_target_type
    and reconciliation.target_id = p_target_id;

  if p_target_type = 'goal' then
    update public.goals
    set current_amount = case
      when v_count = 0 then v_base.base_amount
      when goal_type = 'planned_expense' then v_base.base_amount + v_total
      when v_has_closing then target_amount
      else least(target_amount, v_base.base_amount + v_total)
    end
    where id = p_target_id;
  elsif p_target_type = 'decision' then
    update public.decisions
    set actual_amount = case when v_count = 0 then nullif(v_base.base_amount, 0) else v_base.base_amount + v_total end,
        status = case
          when v_count = 0 then coalesce(v_base.base_status, status)
          when v_has_closing
            or v_base.base_amount + v_total + 0.005 >= abs(coalesce((scenario->>'amount')::numeric, 0))
            then 'completed'
          else coalesce(v_base.base_status, status)
        end,
        completed_at = case
          when v_count = 0 then v_base.base_completed_at
          when v_has_closing
            or v_base.base_amount + v_total + 0.005 >= abs(coalesce((scenario->>'amount')::numeric, 0))
            then coalesce(v_latest, now())
          else v_base.base_completed_at
        end,
        updated_at = now()
    where id = p_target_id;
  end if;

  if v_count = 0 then
    delete from private.planned_reconciliation_bases
    where target_type = p_target_type and target_id = p_target_id;
  end if;
end;
$function$
;

-- Keep the older trigger as a compatibility delegate, with no second counter.
create or replace function public.sync_reconciliation_target_progress()
returns trigger language plpgsql set search_path = '' as $$
#variable_conflict use_variable
declare r public.transaction_reconciliations%rowtype;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.resolution in ('goal','decision') and r.target_id is not null then
    perform private.recompute_planned_reconciliation_target(r.resolution,r.target_id);
  end if;
  return null;
end;
$$;
revoke all on function public.sync_reconciliation_target_progress() from public,anon,authenticated,service_role;

create or replace function private.add_bucket_purchase(
 p_bucket_id text, p_transaction_id text, p_expected_amount numeric,
 p_expected_date date, p_new_transaction jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
 actor uuid := auth.uid(); g public.goals%rowtype; t public.transactions%rowtype;
 r public.transaction_reconciliations%rowtype; prior jsonb; allocations jsonb; intent jsonb;
 actual numeric; account text; created boolean := false;
begin
 if actor is null then raise exception 'Sign in to add a purchase'; end if;
 if nullif(btrim(p_transaction_id),'') is null or length(p_transaction_id)>200 then raise exception 'A stable purchase id is required'; end if;
 if p_expected_amount is null or lower(p_expected_amount::text) in ('nan','infinity','-infinity') or p_expected_amount<=0 or p_expected_amount>1000000000 or round(p_expected_amount,2)<>p_expected_amount then raise exception 'Choose a positive purchase amount with at most two decimals'; end if;
 if p_expected_date is null then raise exception 'Choose a purchase date'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bucket-purchase:'||p_transaction_id,0));
 select * into t from public.transactions where id=p_transaction_id for update;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.household_id is null or g.goal_type<>'planned_expense' then raise exception 'Spending bucket not found'; end if;
 if not private.is_household_editor(g.household_id) then raise exception 'You need household edit access to add a purchase'; end if;
 if not private.has_review_center_entitlement(g.household_id) then raise exception 'Bucket purchase matching is unavailable for this household'; end if;
 intent := jsonb_build_object('version',1,'bucketId',p_bucket_id,'amount',p_expected_amount,'date',p_expected_date,'newTransaction',p_new_transaction);
 select * into r from public.transaction_reconciliations where transaction_id=p_transaction_id for update;
 if r.transaction_id is not null and r.resolution='goal' and r.target_id=p_bucket_id and r.restore_snapshot->'bucketPurchaseIntent'=intent
   and t.household_id=g.household_id and t.budget_id is not distinct from g.budget_id
   and t.linked_plan_type='goal' and t.linked_plan_id=g.id and t.deleted_at is null and t.removed_at is null then
  return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true);
 end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen this bucket before adding a purchase'; end if;
 if t.id is null then
  if p_new_transaction is null or jsonb_typeof(p_new_transaction)<>'object' then raise exception 'Transaction not found'; end if;
  if (p_new_transaction->>'amount')::numeric is distinct from -p_expected_amount or (p_new_transaction->>'date')::date is distinct from p_expected_date then raise exception 'The purchase details changed'; end if;
  if nullif(btrim(p_new_transaction->>'category'),'') is null or p_new_transaction->>'category'='Transfer' then raise exception 'Choose a purchase category'; end if;
  if length(coalesce(p_new_transaction->>'note',''))>2000 then raise exception 'Keep the purchase description under 2000 characters'; end if;
  account := nullif(p_new_transaction->>'account_id','');
  if account is not null and not exists(select 1 from public.accounts a where a.id=account and a.household_id=g.household_id and a.is_active) then raise exception 'Choose an active household account'; end if;
  insert into public.transactions(id,user_id,household_id,budget_id,date,amount,category,note,account_id,source,review_status)
   values(p_transaction_id,actor,g.household_id,g.budget_id,p_expected_date::text,-p_expected_amount,p_new_transaction->>'category',coalesce(p_new_transaction->>'note',''),account,'manual','legacy_reviewed') returning * into t;
  created:=true;
 elsif p_new_transaction is not null then
  raise exception 'That purchase id is already in use';
 end if;
 if t.household_id is distinct from g.household_id or t.budget_id is distinct from g.budget_id then raise exception 'Choose a transaction from this household plan'; end if;
 if t.pending is true or t.removed_at is not null or t.deleted_at is not null or t.amount>=0 or t.transfer_group_id is not null or t.category='Transfer'
  or t.linked_bill_id is not null or t.linked_income_id is not null or t.linked_plan_id is not null or t.debt_applied_bill_id is not null or coalesce(t.debt_applied_amount,0)<>0
  or t.review_status in ('matched','transfer') or (t.source is not null and t.source not in ('manual','plaid','statement')) then raise exception 'This transaction is already assigned or cannot be used as a purchase'; end if;
 if r.transaction_id is not null and r.resolution<>'category' then raise exception 'Undo the existing transaction match before using this bucket'; end if;
 if t.source='plaid' and not exists(select 1 from public.plaid_accounts a where a.household_id=g.household_id and (a.plaid_account_id=t.plaid_account_id or a.id::text=t.plaid_account_id) and lower(coalesce(a.account_type,a.type,'')) in ('depository','checking') and lower(coalesce(a.account_subtype,a.subtype,''))='checking') then raise exception 'Choose a posted checking-account transaction'; end if;
 actual:=round(abs(t.amount),2);
 if actual<>p_expected_amount or t.date::date<>p_expected_date then raise exception 'The transaction changed. Refresh and choose it again'; end if;
 if actual>g.target_amount-g.current_amount+0.005 then raise exception 'This purchase exceeds the money left. Adjust the bucket budget first'; end if;
 prior:=jsonb_build_object('category',t.category,'linkedBillId',t.linked_bill_id,'linkedIncomeId',t.linked_income_id,'linkedPlanId',t.linked_plan_id,'linkedPlanType',t.linked_plan_type,'matchConfidence',t.match_confidence,'matchReason',t.match_reason,
  'goalCurrentAmount',g.current_amount,'bucketPurchaseIntent',intent,'bucketPriorTransaction',to_jsonb(t),'bucketPriorReconciliation',case when r.transaction_id is null then null else to_jsonb(r) end,'bucketCreated',created);
 allocations:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',actual,'plannedAmount',actual,'occurrenceDate',t.date,'settlement','partial'));
 if r.transaction_id is not null then delete from public.transaction_reconciliations where transaction_id=t.id; end if;
 update public.transactions set linked_plan_id=g.id,linked_plan_type='goal',matched_occurrence_date=p_expected_date,match_confidence=1,match_reason='confirmed_bucket_purchase',review_status='matched',review_resolution='goal',review_allocations=allocations,reviewed_at=now(),reviewed_by=actor where id=t.id returning * into t;
 insert into public.transaction_reconciliations(transaction_id,user_id,household_id,budget_id,resolution,target_id,occurrence_date,settlement,planned_amount,allocations,restore_snapshot,reviewed_by,reviewed_at,updated_at)
  values(t.id,t.user_id,t.household_id,t.budget_id,'goal',g.id,p_expected_date,'partial',actual,allocations,prior,actor,now(),now());
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
end;
$$;

create or replace function public.add_bucket_purchase(p_bucket_id text,p_transaction_id text,p_expected_amount numeric,p_expected_date date,p_new_transaction jsonb default null)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.add_bucket_purchase(p_bucket_id,p_transaction_id,p_expected_amount,p_expected_date,p_new_transaction) $$;
revoke all on function private.add_bucket_purchase(text,text,numeric,date,jsonb) from public,anon,service_role;
revoke all on function public.add_bucket_purchase(text,text,numeric,date,jsonb) from public,anon,service_role;
grant execute on function private.add_bucket_purchase(text,text,numeric,date,jsonb) to authenticated;
grant execute on function public.add_bucket_purchase(text,text,numeric,date,jsonb) to authenticated;

-- Replace one explicitly selected manual purchase with its posted bank charge.
-- Move the same goal reconciliation; never add a second bucket allocation.
create or replace function private.replace_bucket_purchase(
 p_bank_id text,p_manual_id text,p_expected_manual_amount numeric,p_expected_bank_amount numeric,p_expected_bank_date date
) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare b public.transactions%rowtype; m public.transactions%rowtype; g public.goals%rowtype;
 r public.transaction_reconciliations%rowtype; allocation jsonb; snapshot jsonb; amount numeric;
begin
 if auth.uid() is null then raise exception 'Sign in to match this purchase'; end if;
 select * into b from public.transactions where id=p_bank_id for update;
 if not found or b.source is distinct from 'plaid' or b.pending is true or b.deleted_at is not null or b.removed_at is not null then raise exception 'Posted bank transaction not found'; end if;
 if b.household_id is null or not private.is_household_editor(b.household_id) or not private.has_review_center_entitlement(b.household_id) then raise exception 'Household edit access is required'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=b.id for update;
 if r.resolution='goal' and r.restore_snapshot->>'bucketReplacementManualId'=p_manual_id
   and (r.restore_snapshot->>'bucketReplacementExpectedManualAmount')::numeric=p_expected_manual_amount
   and abs(b.amount)=p_expected_bank_amount and b.date::date=p_expected_bank_date then
  select * into g from public.goals where id=r.target_id;
  return jsonb_build_object('transaction',to_jsonb(b),'goal',to_jsonb(g),'retry',true);
 end if;
 if b.review_status<>'needs_review' or b.linked_bill_id is not null or b.linked_plan_id is not null or b.linked_income_id is not null
  or b.transfer_group_id is not null or b.debt_applied_bill_id is not null or coalesce(b.debt_applied_amount,0)<>0 or r.transaction_id is not null then raise exception 'This bank transaction is already assigned'; end if;
 if not exists(select 1 from public.plaid_accounts a where a.household_id=b.household_id and (a.plaid_account_id=b.plaid_account_id or a.id::text=b.plaid_account_id) and lower(coalesce(a.account_type,a.type,'')) in ('depository','checking') and lower(coalesce(a.account_subtype,a.subtype,''))='checking') then raise exception 'Choose a posted checking-account transaction'; end if;
 select * into m from public.transactions where id=p_manual_id and id<>p_bank_id for update;
 if not found or (m.source is not null and m.source<>'manual') or m.import_hash is not null or m.pending is true or m.deleted_at is not null or m.removed_at is not null
  or m.linked_plan_type is distinct from 'goal' or m.review_resolution is distinct from 'goal' or m.linked_bill_id is not null or m.linked_income_id is not null or m.transfer_group_id is not null
  or m.debt_applied_bill_id is not null or coalesce(m.debt_applied_amount,0)<>0 or m.amount>=0 then raise exception 'Manual bucket purchase not found'; end if;
 if m.household_id is distinct from b.household_id or m.budget_id is distinct from b.budget_id then raise exception 'Choose a purchase from this household plan'; end if;
 if abs(m.amount) is distinct from p_expected_manual_amount or abs(b.amount) is distinct from p_expected_bank_amount or b.date::date is distinct from p_expected_bank_date
  then raise exception 'Purchase details changed. Refresh and choose again'; end if;
 if date_trunc('month',m.date::date)<>date_trunc('month',b.date::date) and not exists(
  select 1 from public.pending_plan_matches link where link.target_type='manual' and link.target_id=m.id and link.status='ready_review'
   and link.household_id=b.household_id and link.budget_id is not distinct from b.budget_id
   and (link.posted_transaction_id=b.id or link.posted_plaid_transaction_id=b.plaid_transaction_id)
   and (link.posted_transaction_id is null or link.posted_transaction_id=b.id)
   and (link.posted_plaid_transaction_id is null or link.posted_plaid_transaction_id=b.plaid_transaction_id)
 ) then raise exception 'Manual and posted purchases must be in the same month unless explicitly linked while pending'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=m.id and resolution='goal' and target_id=m.linked_plan_id for update;
 if not found then raise exception 'The manual purchase allocation is no longer available'; end if;
 select * into g from public.goals where id=r.target_id for update;
 if not found or g.goal_type<>'planned_expense' or g.household_id is distinct from b.household_id or g.budget_id is distinct from b.budget_id then raise exception 'Spending bucket not found'; end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen the bucket before replacing this purchase'; end if;
 select coalesce(sum((x->>'amount')::numeric),0) into amount from jsonb_array_elements(r.allocations) x where x->>'type'='planned_expense' and x->>'source'='goal' and x->>'targetId'=g.id;
 if amount<=0 or abs(amount-abs(m.amount))>0.005 then raise exception 'This split purchase must be removed from its bucket before replacement'; end if;
 if p_expected_bank_amount<=0 or p_expected_bank_amount>1000000000 or lower(p_expected_bank_amount::text) in ('nan','infinity','-infinity')
  or p_expected_bank_amount>g.target_amount-g.current_amount+amount+0.005 then raise exception 'The posted amount exceeds the bucket budget. Adjust the budget first'; end if;
 snapshot:=r.restore_snapshot||jsonb_build_object('bucketReplacementManualId',m.id,'bucketReplacementExpectedManualAmount',p_expected_manual_amount,
  'bucketReplacementManual',to_jsonb(m),'bucketReplacementReconciliation',to_jsonb(r),'bucketReplacementBank',to_jsonb(b));
 allocation:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',p_expected_bank_amount,'plannedAmount',p_expected_bank_amount,'occurrenceDate',b.date,'settlement','partial'));
 update public.transaction_reconciliations set transaction_id=b.id,user_id=b.user_id,occurrence_date=b.date::date,settlement='partial',planned_amount=p_expected_bank_amount,allocations=allocation,restore_snapshot=snapshot,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where transaction_id=m.id;
 update public.transactions set removed_at=now(),match_reason='replaced_by_posted_transaction' where id=m.id;
 update public.transactions set category=m.category,note=coalesce(nullif(btrim(m.note),''),b.note),linked_plan_id=g.id,linked_plan_type='goal',matched_occurrence_date=b.date::date,
  review_status='matched',review_resolution='goal',review_allocations=allocation,match_confidence=1,match_reason='confirmed_bucket_replacement',reviewed_at=now(),reviewed_by=auth.uid() where id=b.id returning * into b;
 select * into g from public.goals where id=g.id;
 return jsonb_build_object('transaction',to_jsonb(b),'goal',to_jsonb(g),'manual_id',m.id,'retry',false);
end;
$$;
create or replace function public.replace_bucket_purchase(p_bank_id text,p_manual_id text,p_expected_manual_amount numeric,p_expected_bank_amount numeric,p_expected_bank_date date)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.replace_bucket_purchase(p_bank_id,p_manual_id,p_expected_manual_amount,p_expected_bank_amount,p_expected_bank_date) $$;
revoke all on function private.replace_bucket_purchase(text,text,numeric,numeric,date) from public,anon,service_role;
revoke all on function public.replace_bucket_purchase(text,text,numeric,numeric,date) from public,anon,service_role;
grant execute on function private.replace_bucket_purchase(text,text,numeric,numeric,date) to authenticated;
grant execute on function public.replace_bucket_purchase(text,text,numeric,numeric,date) to authenticated;

create or replace function private.undo_bucket_purchase(p_transaction_id text,p_bucket_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare t public.transactions%rowtype; m public.transactions%rowtype; g public.goals%rowtype;
 r public.transaction_reconciliations%rowtype; saved public.transaction_reconciliations%rowtype; snapshot jsonb; prior public.transactions%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to remove a purchase'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if not found or t.household_id is null or not private.is_household_editor(t.household_id) or not private.has_review_center_entitlement(t.household_id) then raise exception 'Household edit access is required'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=t.id for update;
 if r.transaction_id is null and t.linked_plan_id is not null then raise exception 'This purchase is no longer available'; end if;
 -- Lock both cash representations before the goal, matching the replacement RPC.
 if r.restore_snapshot ? 'bucketReplacementManualId' then
  perform 1 from public.transactions where id=r.restore_snapshot->>'bucketReplacementManualId' for update;
 end if;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.goal_type<>'planned_expense' or g.household_id is distinct from t.household_id or g.budget_id is distinct from t.budget_id then raise exception 'Spending bucket not found'; end if;
 if r.transaction_id is null and t.linked_plan_id is null then return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true); end if;
 if r.resolution is distinct from 'goal' or r.target_id is distinct from p_bucket_id or t.linked_plan_type is distinct from 'goal' or t.linked_plan_id is distinct from p_bucket_id or t.removed_at is not null or t.deleted_at is not null then raise exception 'This transaction is not an active purchase in this bucket'; end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen this bucket before removing a purchase'; end if;
 snapshot:=r.restore_snapshot;
 if snapshot ? 'bucketReplacementManualId' then
  select * into m from public.transactions where id=snapshot->>'bucketReplacementManualId' for update;
  if not found or m.household_id is distinct from g.household_id or m.budget_id is distinct from g.budget_id or m.deleted_at is not null then raise exception 'The original manual purchase is no longer available'; end if;
  if exists(select 1 from public.transaction_reconciliations where transaction_id=m.id) then raise exception 'The manual purchase already has a different match'; end if;
  saved:=jsonb_populate_record(null::public.transaction_reconciliations,snapshot->'bucketReplacementReconciliation');
  update public.transaction_reconciliations set transaction_id=m.id,user_id=saved.user_id,occurrence_date=saved.occurrence_date,settlement=saved.settlement,planned_amount=saved.planned_amount,allocations=saved.allocations,restore_snapshot=saved.restore_snapshot,reviewed_by=saved.reviewed_by,reviewed_at=saved.reviewed_at,updated_at=now() where transaction_id=t.id;
  prior:=jsonb_populate_record(null::public.transactions,snapshot->'bucketReplacementManual');
  update public.transactions set removed_at=prior.removed_at,match_reason=prior.match_reason where id=m.id;
  prior:=jsonb_populate_record(null::public.transactions,snapshot->'bucketReplacementBank');
  update public.transactions set category=prior.category,note=prior.note,linked_plan_id=prior.linked_plan_id,linked_plan_type=prior.linked_plan_type,linked_bill_id=prior.linked_bill_id,linked_income_id=prior.linked_income_id,
   matched_occurrence_date=prior.matched_occurrence_date,match_confidence=prior.match_confidence,match_reason=prior.match_reason,review_status=prior.review_status,review_resolution=prior.review_resolution,review_allocations=prior.review_allocations,reviewed_at=prior.reviewed_at,reviewed_by=prior.reviewed_by where id=t.id returning * into t;
 else
  perform private.undo_transaction_reconciliation(t.id);
  if snapshot ? 'bucketPriorTransaction' then
   prior:=jsonb_populate_record(null::public.transactions,snapshot->'bucketPriorTransaction');
   if snapshot->'bucketPriorReconciliation' is not null and snapshot->'bucketPriorReconciliation'<>'null'::jsonb then
    saved:=jsonb_populate_record(null::public.transaction_reconciliations,snapshot->'bucketPriorReconciliation');
    insert into public.transaction_reconciliations select saved.*;
   end if;
   update public.transactions set review_status=prior.review_status,review_resolution=prior.review_resolution,review_allocations=prior.review_allocations,reviewed_at=prior.reviewed_at,reviewed_by=prior.reviewed_by,matched_occurrence_date=prior.matched_occurrence_date where id=t.id;
  end if;
  select * into t from public.transactions where id=t.id;
 end if;
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
end;
$$;
create or replace function public.undo_bucket_purchase(p_transaction_id text,p_bucket_id text)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.undo_bucket_purchase(p_transaction_id,p_bucket_id) $$;
revoke all on function private.undo_bucket_purchase(text,text) from public,anon,service_role;
revoke all on function public.undo_bucket_purchase(text,text) from public,anon,service_role;
grant execute on function private.undo_bucket_purchase(text,text) to authenticated;
grant execute on function public.undo_bucket_purchase(text,text) to authenticated;

create or replace function private.update_bucket_purchase(p_transaction_id text,p_bucket_id text,p_expected_amount numeric,p_transaction jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare t public.transactions%rowtype; g public.goals%rowtype; r public.transaction_reconciliations%rowtype; actual numeric; old_applied numeric; account text; allocations jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to update a purchase'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if not found or t.household_id is null or not private.is_household_editor(t.household_id) or not private.has_review_center_entitlement(t.household_id) then raise exception 'Household edit access is required'; end if;
 select * into r from public.transaction_reconciliations where transaction_id=t.id and resolution='goal' and target_id=p_bucket_id for update;
 if not found or t.linked_plan_type is distinct from 'goal' or t.linked_plan_id is distinct from p_bucket_id or t.pending is true or t.removed_at is not null or t.deleted_at is not null then raise exception 'Active bucket purchase not found'; end if;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.goal_type<>'planned_expense' or g.household_id is distinct from t.household_id or g.budget_id is distinct from t.budget_id or g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen the bucket before changing its purchase'; end if;
 if (t.source is not null and t.source<>'manual') or t.import_hash is not null then raise exception 'Remove this bank purchase from its bucket before changing transaction details'; end if;
 actual:=-(p_transaction->>'amount')::numeric;
 if actual is null or lower(actual::text) in ('nan','infinity','-infinity') or actual<=0 or actual>1000000000 or round(actual,2)<>actual then raise exception 'Enter a positive purchase amount'; end if;
 if nullif(p_transaction->>'date','') is null or nullif(btrim(p_transaction->>'category'),'') is null or p_transaction->>'category'='Transfer' then raise exception 'Choose a purchase date and category'; end if;
 perform (p_transaction->>'date')::date;
 account:=nullif(p_transaction->>'account_id','');
 if account is not null and not exists(select 1 from public.accounts a where a.id=account and a.household_id=g.household_id and a.is_active) then raise exception 'Choose an active household account'; end if;
 if t.amount=-actual and t.date=p_transaction->>'date' and t.category=p_transaction->>'category' and t.note=coalesce(p_transaction->>'note','') and t.account_id is not distinct from account then
  return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',true);
 end if;
 if t.amount is distinct from p_expected_amount then raise exception 'The purchase changed on another device. Refresh and try again'; end if;
 select coalesce(sum((x->>'amount')::numeric),0) into old_applied from jsonb_array_elements(r.allocations) x where x->>'type'='planned_expense' and x->>'source'='goal' and x->>'targetId'=g.id;
 if abs(old_applied-abs(t.amount))>0.005 then raise exception 'Remove this split purchase from the bucket before editing its amount'; end if;
 if actual>old_applied+0.005 and actual>g.target_amount-g.current_amount+old_applied+0.005 then raise exception 'The purchase exceeds the bucket budget. Adjust the budget first'; end if;
 allocations:=jsonb_build_array(jsonb_build_object('type','planned_expense','source','goal','targetId',g.id,'name',g.name,'amount',actual,'plannedAmount',actual,'occurrenceDate',p_transaction->>'date','settlement','partial'));
 update public.transaction_reconciliations set allocations=allocations,planned_amount=actual,settlement='partial',occurrence_date=(p_transaction->>'date')::date,updated_at=now() where transaction_id=t.id;
 update public.transactions set amount=-actual,date=p_transaction->>'date',category=p_transaction->>'category',note=coalesce(p_transaction->>'note',''),account_id=account,review_allocations=allocations,matched_occurrence_date=(p_transaction->>'date')::date,user_edited_at=now() where id=t.id returning * into t;
 select * into g from public.goals where id=p_bucket_id;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',false);
end;
$$;
create or replace function public.update_bucket_purchase(p_transaction_id text,p_bucket_id text,p_expected_amount numeric,p_transaction jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.update_bucket_purchase(p_transaction_id,p_bucket_id,p_expected_amount,p_transaction) $$;
revoke all on function private.update_bucket_purchase(text,text,numeric,jsonb) from public,anon,service_role;
revoke all on function public.update_bucket_purchase(text,text,numeric,jsonb) from public,anon,service_role;
grant execute on function private.update_bucket_purchase(text,text,numeric,jsonb) to authenticated;
grant execute on function public.update_bucket_purchase(text,text,numeric,jsonb) to authenticated;

create or replace function private.delete_bucket_purchase(p_transaction_id text,p_bucket_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare result jsonb; t public.transactions%rowtype; g public.goals%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to delete a purchase'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if not found or t.household_id is null or not private.is_household_editor(t.household_id) then raise exception 'Household edit access is required'; end if;
 if t.deleted_at is null then
  result:=private.undo_bucket_purchase(t.id,p_bucket_id);
  update public.transactions set deleted_at=now(),deleted_by=auth.uid() where id=t.id returning * into t;
 end if;
 select * into g from public.goals where id=p_bucket_id and household_id=t.household_id and budget_id is not distinct from t.budget_id;
 if not found then raise exception 'Spending bucket not found'; end if;
 return jsonb_build_object('transaction',to_jsonb(t),'goal',to_jsonb(g),'retry',result is null);
end;
$$;
create or replace function public.delete_bucket_purchase(p_transaction_id text,p_bucket_id text)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.delete_bucket_purchase(p_transaction_id,p_bucket_id) $$;
revoke all on function private.delete_bucket_purchase(text,text) from public,anon,service_role;
revoke all on function public.delete_bucket_purchase(text,text) from public,anon,service_role;
grant execute on function private.delete_bucket_purchase(text,text) to authenticated;
grant execute on function public.delete_bucket_purchase(text,text) to authenticated;

-- Ordinary client edits cannot change an allocated cash amount behind its bucket.
create or replace function private.guard_bucket_purchase_edit() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','service_role','supabase_admin') and old.linked_plan_type='goal'
  and exists(select 1 from public.goals where id=old.linked_plan_id and goal_type='planned_expense')
  and row(new.amount,new.date,new.account_id,new.deleted_at,new.removed_at,new.source,new.household_id,new.budget_id)
    is distinct from row(old.amount,old.date,old.account_id,old.deleted_at,old.removed_at,old.source,old.household_id,old.budget_id) then
  raise exception 'Use the bucket purchase action to update or remove this allocated transaction';
 end if;
 return new;
end;
$$;
revoke all on function private.guard_bucket_purchase_edit() from public,anon,authenticated,service_role;
drop trigger if exists transactions_guard_bucket_purchase_edit on public.transactions;
create trigger transactions_guard_bucket_purchase_edit before update on public.transactions for each row execute function private.guard_bucket_purchase_edit();
notify pgrst,'reload schema';

create or replace function private.update_bucket_budget(p_bucket_id text,p_name text,p_target_amount numeric,p_target_date date,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare g public.goals%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to adjust the bucket'; end if;
 select * into g from public.goals where id=p_bucket_id for update;
 if not found or g.household_id is null or g.goal_type<>'planned_expense' or not private.is_household_editor(g.household_id) then raise exception 'Household edit access is required'; end if;
 if g.closed_at is not null or g.archived_at is not null then raise exception 'Reopen this bucket before adjusting its budget'; end if;
 if p_target_amount is null or lower(p_target_amount::text) in ('nan','infinity','-infinity') or p_target_amount<=0 or p_target_amount>1000000000 or round(p_target_amount,2)<>p_target_amount or p_target_amount+0.005<g.current_amount then raise exception 'The bucket budget must cover its existing purchases'; end if;
 if nullif(btrim(p_name),'') is null or length(btrim(p_name))>120 or p_target_date is null then raise exception 'Choose a bucket name and target date'; end if;
 if g.name=p_name and g.target_amount=p_target_amount and g.target_date::date=p_target_date then return jsonb_build_object('goal',to_jsonb(g),'retry',true); end if;
 if p_expected is null or g.name is distinct from p_expected->>'name' or g.target_amount is distinct from (p_expected->>'target_amount')::numeric or g.target_date::date is distinct from (p_expected->>'target_date')::date then raise exception 'The bucket budget changed on another device. Refresh and try again'; end if;
 update public.goals set name=btrim(p_name),target_amount=p_target_amount,target_date=p_target_date::text where id=g.id returning * into g;
 return jsonb_build_object('goal',to_jsonb(g),'retry',false);
end;
$$;
create or replace function public.update_bucket_budget(p_bucket_id text,p_name text,p_target_amount numeric,p_target_date date,p_expected jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$ select private.update_bucket_budget(p_bucket_id,p_name,p_target_amount,p_target_date,p_expected) $$;
revoke all on function private.update_bucket_budget(text,text,numeric,date,jsonb) from public,anon,service_role;
revoke all on function public.update_bucket_budget(text,text,numeric,date,jsonb) from public,anon,service_role;
grant execute on function private.update_bucket_budget(text,text,numeric,date,jsonb) to authenticated;
grant execute on function public.update_bucket_budget(text,text,numeric,date,jsonb) to authenticated;

create or replace function private.guard_bucket_budget_edit() returns trigger language plpgsql set search_path='' as $$
begin
 -- Existing overspent buckets must remain reopenable and repairable.
 if old.goal_type='planned_expense' and new.target_amount is distinct from old.target_amount
  and new.target_amount+0.005<old.current_amount then raise exception 'The bucket budget must cover its existing purchases'; end if;
 if current_user not in ('postgres','service_role','supabase_admin') and old.goal_type='planned_expense'
  and (new.current_amount is distinct from old.current_amount or new.goal_type is distinct from old.goal_type) then
  raise exception 'Bucket spending changed. Refresh before editing this budget';
 end if;
 return new;
end;
$$;
revoke all on function private.guard_bucket_budget_edit() from public,anon,authenticated,service_role;
drop trigger if exists goals_guard_bucket_budget_edit on public.goals;
create trigger goals_guard_bucket_budget_edit before update on public.goals for each row execute function private.guard_bucket_budget_edit();
