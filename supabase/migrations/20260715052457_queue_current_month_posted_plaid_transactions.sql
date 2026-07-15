-- Every active posted Plaid transaction in the current calendar month that has
-- not already been reconciled belongs in Review Center.
update public.transactions t
set review_status = 'needs_review',
    review_resolution = null,
    review_allocations = '[]'::jsonb,
    reviewed_at = null,
    reviewed_by = null
where t.source = 'plaid'
  and t.pending is not true
  and t.removed_at is null
  and t.review_status = 'legacy_reviewed'
  and t.linked_bill_id is null
  and t.linked_income_id is null
  and t.linked_plan_id is null
  and t.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  and date_trunc('month', t.date::date) = date_trunc('month', current_date)
  and not exists (
    select 1 from public.transaction_reconciliations r
    where r.transaction_id = t.id
  );

create or replace function public.undo_transaction_reconciliation(p_transaction_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_recon public.transaction_reconciliations%rowtype;
  v_snapshot jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to undo a review'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id;
  select * into v_recon from public.transaction_reconciliations where transaction_id = p_transaction_id;
  if not found then raise exception 'This transaction has not been reviewed'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then raise exception 'You need household edit access'; end if;
  if not exists (select 1 from public.household_plans hp where hp.household_id = v_tx.household_id and hp.tier = 'pro') then raise exception 'Review Center requires the Pro plan'; end if;
  v_snapshot := v_recon.restore_snapshot;

  if v_recon.resolution = 'bill' and v_tx.linked_bill_id is not null then
    perform public.unmatch_transaction_from_bill(p_transaction_id);
  elsif v_recon.resolution = 'goal' and v_recon.target_id is not null then
    update public.goals set current_amount = coalesce((v_snapshot->>'goalCurrentAmount')::numeric, current_amount) where id = v_recon.target_id;
  elsif v_recon.resolution = 'decision' and v_recon.target_id is not null then
    update public.decisions set
      status = coalesce(v_snapshot->>'decisionStatus', status),
      actual_amount = case when v_snapshot ? 'decisionActualAmount' and v_snapshot->>'decisionActualAmount' is not null then (v_snapshot->>'decisionActualAmount')::numeric else null end,
      completed_at = case when v_snapshot ? 'decisionCompletedAt' and v_snapshot->>'decisionCompletedAt' is not null then (v_snapshot->>'decisionCompletedAt')::timestamptz else null end,
      updated_at = now()
    where id = v_recon.target_id;
  end if;

  delete from public.transaction_reconciliations where transaction_id = p_transaction_id;
  update public.transactions set
    category = coalesce(v_snapshot->>'category', category),
    linked_bill_id = nullif(v_snapshot->>'linkedBillId', ''),
    linked_income_id = nullif(v_snapshot->>'linkedIncomeId', ''),
    linked_plan_id = nullif(v_snapshot->>'linkedPlanId', ''),
    linked_plan_type = nullif(v_snapshot->>'linkedPlanType', ''),
    match_confidence = case when v_snapshot ? 'matchConfidence' and v_snapshot->>'matchConfidence' is not null then (v_snapshot->>'matchConfidence')::numeric else null end,
    match_reason = nullif(v_snapshot->>'matchReason', ''),
    matched_occurrence_date = null,
    review_status = case
      when source = 'plaid'
        and pending is not true
        and removed_at is null
        and date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and date_trunc('month', date::date) = date_trunc('month', current_date)
      then 'needs_review'
      else 'legacy_reviewed'
    end,
    review_resolution = null,
    review_allocations = '[]'::jsonb,
    reviewed_at = null,
    reviewed_by = null
  where id = p_transaction_id;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'needs_review');
end;
$$;

revoke execute on function public.undo_transaction_reconciliation(text) from public, anon;
grant execute on function public.undo_transaction_reconciliation(text) to authenticated, service_role;
