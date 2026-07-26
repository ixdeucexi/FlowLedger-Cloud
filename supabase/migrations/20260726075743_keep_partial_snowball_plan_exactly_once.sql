-- Keep a Calendar-backed Snowball plan at its current unmatched amount.
-- The posted transaction records the amount already paid, while this row
-- records only what remains, so every cash surface counts the occurrence once.

create or replace function private.reconcile_snowball_transaction(
  p_transaction_id text,
  p_debt_id text,
  p_occurrence_date date,
  p_planned_amount numeric,
  p_settlement text,
  p_extra_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_debt public.bills%rowtype;
  v_payment public.extra_payments%rowtype;
  v_scheduled_plan public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_plan_id text;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_plan_amount numeric;
  v_plan_original_amount numeric;
  v_prior_amount numeric;
  v_remaining numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to review transactions';
  end if;

  select *
  into v_tx
  from public.transactions
  where id = p_transaction_id
    and removed_at is null
    and pending is not true;
  if not found then raise exception 'Posted transaction was not found'; end if;
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match a Snowball payment'; end if;
  if v_tx.review_status is distinct from 'needs_review' then
    raise exception 'This transaction has already been reviewed';
  end if;
  if v_tx.household_id is null or not private.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1
    from public.household_plans plan
    where plan.household_id = v_tx.household_id
      and plan.tier = 'pro'
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;
  if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then
    raise exception 'Snowball occurrence details are required';
  end if;
  if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split', 'extra_principal') then
    raise exception 'Choose how this Snowball payment was paid';
  end if;

  select *
  into v_debt
  from public.bills
  where id = p_debt_id
    and is_debt;
  if not found
    or v_debt.household_id is distinct from v_tx.household_id
    or v_debt.budget_id is distinct from v_tx.budget_id then
    raise exception 'Debt does not belong to this household plan';
  end if;

  select payment.*
  into v_payment
  from public.extra_payments payment
  where payment.household_id = v_tx.household_id
    and payment.budget_id is not distinct from v_tx.budget_id
    and payment.payment_date = p_occurrence_date
    and exists (
      select 1
      from jsonb_array_elements(coalesce(payment.allocations, '[]'::jsonb)) allocation
      where allocation ->> 'billId' = p_debt_id
        and coalesce((allocation ->> 'payment')::numeric, 0) > 0
    )
  order by payment.id
  limit 1
  for update;

  if found then
    v_plan_id := v_payment.id;
    select coalesce(sum((allocation ->> 'payment')::numeric), 0)
    into v_plan_amount
    from jsonb_array_elements(coalesce(v_payment.allocations, '[]'::jsonb)) allocation
    where allocation ->> 'billId' = p_debt_id;
  else
    select plan.*
    into v_scheduled_plan
    from public.transactions plan
    where plan.household_id = v_tx.household_id
      and plan.budget_id is not distinct from v_tx.budget_id
      and plan.source = 'snowball_plan'
      and plan.date::date = p_occurrence_date
      and plan.amount < 0
      and plan.removed_at is null
      and plan.pending is not true
      and coalesce(plan.debt_applied_bill_id, plan.linked_bill_id) = p_debt_id
    order by plan.id
    limit 1
    for update;
    if not found then raise exception 'Snowball payment was not found'; end if;

    v_plan_id := v_scheduled_plan.id;
    v_plan_amount := abs(v_scheduled_plan.amount);
  end if;

  select coalesce(sum((allocation ->> 'amount')::numeric), 0)
  into v_prior_amount
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) allocation
  where reconciliation.resolution = 'snowball'
    and reconciliation.target_id = v_plan_id
    and reconciliation.occurrence_date = p_occurrence_date
    and allocation ->> 'type' = 'extra_principal'
    and allocation ->> 'targetId' = p_debt_id;

  v_remaining := case
    when v_scheduled_plan.id is not null then v_plan_amount
    else greatest(0, v_plan_amount - v_prior_amount)
  end;
  v_plan_original_amount := case
    when v_scheduled_plan.id is not null then v_plan_amount + v_prior_amount
    else v_plan_amount
  end;
  if v_remaining <= 0.005 then raise exception 'This Snowball payment is already complete'; end if;
  if abs(v_remaining - p_planned_amount) >= 0.01 then
    raise exception 'This Snowball payment changed. Refresh Review Center and try again';
  end if;

  select *
  into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id;
  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_tx.category,
    'linkedBillId', v_tx.linked_bill_id,
    'linkedIncomeId', v_tx.linked_income_id,
    'linkedPlanId', v_tx.linked_plan_id,
    'linkedPlanType', v_tx.linked_plan_type,
    'matchConfidence', v_tx.match_confidence,
    'matchReason', v_tx.match_reason,
    'scheduledPlanId', v_scheduled_plan.id,
    'scheduledPlanOriginalAmount', v_plan_original_amount
  ) end;

  v_actual := abs(v_tx.amount);
  v_primary := case
    when p_settlement = 'split' then least(v_actual, v_remaining)
    else v_actual
  end;
  v_extra := greatest(0, v_actual - v_primary);
  if p_settlement = 'partial' and v_primary >= v_remaining - 0.005 then
    raise exception 'A partial payment must leave part of the Snowball plan open';
  end if;
  if p_settlement = 'split'
    and (v_extra <= 0 or nullif(btrim(coalesce(p_extra_category, '')), '') is null) then
    raise exception 'Choose a category for the extra amount';
  end if;

  update public.bills
  set balance = greatest(0, balance - v_primary)
  where id = p_debt_id
    and household_id = v_tx.household_id;

  v_allocations := jsonb_build_array(jsonb_build_object(
    'type', 'extra_principal',
    'targetId', p_debt_id,
    'name', v_debt.name,
    'category', 'Debt',
    'amount', v_primary,
    'plannedAmount', v_remaining,
    'occurrenceDate', p_occurrence_date,
    'settlement', p_settlement
  ));
  if v_extra > 0 then
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'type', 'category',
      'category', p_extra_category,
      'amount', v_extra
    ));
  end if;

  update public.transactions
  set category = 'Debt',
      linked_bill_id = null,
      linked_income_id = null,
      linked_plan_id = v_plan_id,
      linked_plan_type = 'snowball',
      matched_occurrence_date = p_occurrence_date,
      match_confidence = 1,
      match_reason = 'confirmed_snowball_match',
      review_status = 'matched',
      review_resolution = 'snowball',
      review_allocations = v_allocations,
      reviewed_at = v_now,
      reviewed_by = (select auth.uid())
  where id = p_transaction_id;

  if v_scheduled_plan.id is not null then
    if p_settlement = 'partial' then
      update public.transactions
      set amount = -round(greatest(0, v_remaining - v_primary), 2),
          removed_at = null
      where id = v_scheduled_plan.id
        and household_id = v_tx.household_id;
    else
      update public.transactions
      set removed_at = v_now
      where id = v_scheduled_plan.id
        and household_id = v_tx.household_id;
    end if;
  end if;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, 'snowball',
    v_plan_id, p_occurrence_date, p_settlement, v_remaining, v_allocations,
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
    'resolution', 'snowball',
    'allocations', v_allocations,
    'reviewed_at', v_now
  );
end;
$$;

revoke all on function private.reconcile_snowball_transaction(
  text, text, date, numeric, text, text
) from public, anon;
grant execute on function private.reconcile_snowball_transaction(
  text, text, date, numeric, text, text
) to authenticated, service_role;

create or replace function public.restore_snowball_reconciliation_on_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  allocation jsonb;
  v_scheduled_plan_id text;
  v_debt_id text;
  v_old_amount numeric := 0;
  v_other_paid numeric := 0;
  v_plan_current_amount numeric;
  v_plan_original_amount numeric;
  v_plan_remaining numeric;
begin
  if old.resolution <> 'snowball' then return old; end if;

  for allocation in
    select value
    from jsonb_array_elements(coalesce(old.allocations, '[]'::jsonb))
    where value ->> 'type' = 'extra_principal'
      and nullif(value ->> 'targetId', '') is not null
      and coalesce((value ->> 'amount')::numeric, 0) > 0
  loop
    update public.bills
    set balance = round(balance + (allocation ->> 'amount')::numeric, 2)
    where id = allocation ->> 'targetId'
      and household_id = old.household_id
      and is_debt;
  end loop;

  v_scheduled_plan_id := nullif(old.restore_snapshot ->> 'scheduledPlanId', '');
  if v_scheduled_plan_id is null then return old; end if;

  select nullif(item ->> 'targetId', ''),
         coalesce((item ->> 'amount')::numeric, 0)
  into v_debt_id, v_old_amount
  from jsonb_array_elements(coalesce(old.allocations, '[]'::jsonb)) item
  where item ->> 'type' = 'extra_principal'
  limit 1;

  select abs(plan.amount)
  into v_plan_current_amount
  from public.transactions plan
  where plan.id = v_scheduled_plan_id
    and plan.household_id = old.household_id
    and plan.source = 'snowball_plan'
  for update;
  if not found then return old; end if;

  select coalesce(sum((item ->> 'amount')::numeric), 0)
  into v_other_paid
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) item
  where reconciliation.transaction_id <> old.transaction_id
    and reconciliation.resolution = 'snowball'
    and reconciliation.target_id = v_scheduled_plan_id
    and reconciliation.occurrence_date = old.occurrence_date
    and item ->> 'type' = 'extra_principal'
    and item ->> 'targetId' = v_debt_id;

  v_plan_original_amount := nullif(old.restore_snapshot ->> 'scheduledPlanOriginalAmount', '')::numeric;
  if v_plan_original_amount is null then
    v_plan_original_amount := greatest(v_plan_current_amount, v_other_paid + v_old_amount);
  end if;
  v_plan_remaining := greatest(0, v_plan_original_amount - v_other_paid);

  if v_plan_remaining > 0.005 then
    update public.transactions
    set amount = -round(v_plan_remaining, 2),
        removed_at = null
    where id = v_scheduled_plan_id
      and household_id = old.household_id
      and source = 'snowball_plan';
  else
    update public.transactions
    set removed_at = coalesce(removed_at, now())
    where id = v_scheduled_plan_id
      and household_id = old.household_id
      and source = 'snowball_plan';
  end if;

  return old;
end;
$$;

revoke execute on function public.restore_snowball_reconciliation_on_delete()
from public, anon, authenticated;

-- Existing scheduled reconciliations were created while the plan row still
-- held its original amount. Preserve that amount for deterministic undo before
-- converting active partial plans to their canonical remainder.
update public.transaction_reconciliations reconciliation
set restore_snapshot = jsonb_set(
      coalesce(reconciliation.restore_snapshot, '{}'::jsonb),
      '{scheduledPlanOriginalAmount}',
      to_jsonb(abs(plan.amount)),
      true
    ),
    updated_at = now()
from public.transactions plan
where reconciliation.resolution = 'snowball'
  and reconciliation.target_id = plan.id
  and nullif(reconciliation.restore_snapshot ->> 'scheduledPlanId', '') = plan.id
  and plan.source = 'snowball_plan'
  and not (coalesce(reconciliation.restore_snapshot, '{}'::jsonb) ? 'scheduledPlanOriginalAmount');

with applied as (
  select reconciliation.target_id as plan_id,
         reconciliation.occurrence_date,
         coalesce(sum((item ->> 'amount')::numeric), 0) as amount
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) item
  where reconciliation.resolution = 'snowball'
    and item ->> 'type' = 'extra_principal'
  group by reconciliation.target_id, reconciliation.occurrence_date
)
update public.transactions plan
set amount = -round(greatest(0, abs(plan.amount) - applied.amount), 2)
from applied
where plan.id = applied.plan_id
  and plan.date::date = applied.occurrence_date
  and plan.source = 'snowball_plan'
  and plan.removed_at is null
  and abs(plan.amount) - applied.amount > 0.005;

with applied as (
  select reconciliation.target_id as plan_id,
         reconciliation.occurrence_date,
         coalesce(sum((item ->> 'amount')::numeric), 0) as amount
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) item
  where reconciliation.resolution = 'snowball'
    and item ->> 'type' = 'extra_principal'
  group by reconciliation.target_id, reconciliation.occurrence_date
)
update public.transactions plan
set removed_at = coalesce(plan.removed_at, now())
from applied
where plan.id = applied.plan_id
  and plan.date::date = applied.occurrence_date
  and plan.source = 'snowball_plan'
  and plan.removed_at is null
  and abs(plan.amount) - applied.amount <= 0.005;

notify pgrst, 'reload schema';
