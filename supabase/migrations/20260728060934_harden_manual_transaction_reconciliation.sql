-- Serialize manual-plan replacement and enforce one posted replacement per
-- manual transaction. Without both row locks, simultaneous reviews can hide
-- the same manual plan twice or hide two manual plans behind one posted row.

create unique index if not exists transaction_reconciliations_one_manual_target
  on public.transaction_reconciliations (target_id)
  where resolution = 'manual' and target_id is not null;

create or replace function private.reconcile_manual_transaction(
  p_transaction_id text,
  p_manual_transaction_id text,
  p_occurrence_date date,
  p_planned_amount numeric,
  p_settlement text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_manual public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and removed_at is null
    and deleted_at is null
    and pending is not true
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match a manual plan'; end if;
  if v_tx.review_status is distinct from 'needs_review' then
    raise exception 'This transaction has already been reviewed';
  end if;

  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and hp.tier = 'pro'
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  select * into v_manual
  from public.transactions
  where id = p_manual_transaction_id
    and id <> p_transaction_id
    and source is distinct from 'plaid'
    and amount < 0
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Manual calendar transaction was not found'; end if;
  if v_manual.household_id is distinct from v_tx.household_id
    or v_manual.budget_id is distinct from v_tx.budget_id then
    raise exception 'Manual transaction does not belong to this household plan';
  end if;
  if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then
    raise exception 'Manual transaction details are required';
  end if;
  if p_occurrence_date is distinct from v_tx.date::date then
    raise exception 'The posted transaction date changed. Refresh Review Center and try again';
  end if;
  if date_trunc('month', v_manual.date::date) is distinct from date_trunc('month', v_tx.date::date) then
    raise exception 'Manual and posted transactions must be in the same month';
  end if;
  if abs(abs(v_manual.amount) - p_planned_amount) >= 0.01 then
    raise exception 'This manual plan changed. Refresh Review Center and try again';
  end if;
  if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then
    raise exception 'Choose how this transaction was paid';
  end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
  for update;

  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason,
    'manualTransactionId', v_manual.id,
    'manualRemovedAt', v_manual.removed_at,
    'manualMatchReason', v_manual.match_reason
  ) end;

  v_actual := abs(v_tx.amount);
  v_allocations := jsonb_build_array(jsonb_build_object(
    'type', 'planned_expense',
    'source', 'transaction',
    'targetId', v_manual.id,
    'name', coalesce(nullif(btrim(v_manual.note), ''), v_manual.category, 'Manual transaction'),
    'category', v_manual.category,
    'amount', v_actual,
    'plannedAmount', p_planned_amount,
    'occurrenceDate', p_occurrence_date,
    'settlement', p_settlement
  ));

  update public.transactions
  set removed_at = v_now,
      match_reason = 'replaced_by_posted_transaction'
  where id = v_manual.id;

  update public.transactions
  set category = v_manual.category,
      linked_bill_id = null,
      linked_income_id = null,
      linked_plan_id = v_manual.id,
      linked_plan_type = 'transaction',
      matched_occurrence_date = p_occurrence_date,
      match_confidence = 1,
      match_reason = 'confirmed_manual_match',
      review_status = 'matched',
      review_resolution = 'manual',
      review_allocations = v_allocations,
      reviewed_at = v_now,
      reviewed_by = (select auth.uid())
  where id = p_transaction_id;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, 'manual',
    v_manual.id, p_occurrence_date, p_settlement, p_planned_amount, v_allocations,
    v_snapshot, (select auth.uid()), v_now, v_now
  )
  on conflict (transaction_id) do update set
    resolution = excluded.resolution,
    target_id = excluded.target_id,
    occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement,
    planned_amount = excluded.planned_amount,
    allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'resolution', 'manual',
    'allocations', v_allocations,
    'reviewed_at', v_now
  );
end;
$$;

create or replace function private.undo_manual_transaction_reconciliation(p_transaction_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_recon public.transaction_reconciliations%rowtype;
  v_snapshot jsonb;
  v_manual_id text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to undo this review'; end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;

  select * into v_recon
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id and resolution = 'manual'
  for update;
  if not found then raise exception 'This manual match was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and hp.tier = 'pro'
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  v_snapshot := v_recon.restore_snapshot;
  v_manual_id := coalesce(v_snapshot->>'manualTransactionId', v_recon.target_id);

  update public.transactions
  set removed_at = case
        when v_snapshot ? 'manualRemovedAt' and v_snapshot->>'manualRemovedAt' is not null
          then (v_snapshot->>'manualRemovedAt')::timestamptz
        else null
      end,
      match_reason = nullif(v_snapshot->>'manualMatchReason', '')
  where id = v_manual_id
    and household_id is not distinct from v_tx.household_id
    and budget_id is not distinct from v_tx.budget_id;

  delete from public.transaction_reconciliations where transaction_id = p_transaction_id;

  update public.transactions
  set category = coalesce(v_snapshot->>'category', category),
      linked_bill_id = nullif(v_snapshot->>'linkedBillId', ''),
      linked_income_id = nullif(v_snapshot->>'linkedIncomeId', ''),
      linked_plan_id = nullif(v_snapshot->>'linkedPlanId', ''),
      linked_plan_type = nullif(v_snapshot->>'linkedPlanType', ''),
      match_confidence = case
        when v_snapshot ? 'matchConfidence' and v_snapshot->>'matchConfidence' is not null
          then (v_snapshot->>'matchConfidence')::numeric
        else null
      end,
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

revoke all on function private.reconcile_manual_transaction(text, text, date, numeric, text)
  from public, anon;
revoke all on function private.undo_manual_transaction_reconciliation(text)
  from public, anon;
grant execute on function private.reconcile_manual_transaction(text, text, date, numeric, text)
  to authenticated, service_role;
grant execute on function private.undo_manual_transaction_reconciliation(text)
  to authenticated, service_role;
