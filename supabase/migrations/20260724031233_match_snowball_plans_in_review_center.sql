-- Let a posted bank charge settle its planned Snowball payment without treating
-- the payment as part of the debt's required minimum.

alter table public.transactions drop constraint if exists transactions_review_resolution_check;
alter table public.transactions add constraint transactions_review_resolution_check
  check (review_resolution is null or review_resolution in ('bill', 'income', 'goal', 'decision', 'snowball', 'category', 'transfer'));

alter table public.transactions drop constraint if exists transactions_linked_plan_type_check;
alter table public.transactions add constraint transactions_linked_plan_type_check
  check (linked_plan_type is null or linked_plan_type in ('goal', 'decision', 'snowball'));

alter table public.transaction_reconciliations drop constraint if exists transaction_reconciliations_resolution_check;
alter table public.transaction_reconciliations add constraint transaction_reconciliations_resolution_check
  check (resolution in ('bill', 'income', 'goal', 'decision', 'snowball', 'category', 'transfer'));

create or replace function public.reconcile_snowball_transaction(
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
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_debt public.bills%rowtype;
  v_payment public.extra_payments%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_plan_amount numeric;
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
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
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
  if not found then raise exception 'Snowball payment was not found'; end if;

  select coalesce(sum((allocation ->> 'payment')::numeric), 0)
  into v_plan_amount
  from jsonb_array_elements(coalesce(v_payment.allocations, '[]'::jsonb)) allocation
  where allocation ->> 'billId' = p_debt_id;

  select coalesce(sum((allocation ->> 'amount')::numeric), 0)
  into v_prior_amount
  from public.transaction_reconciliations reconciliation
  cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) allocation
  where reconciliation.resolution = 'snowball'
    and reconciliation.target_id = v_payment.id
    and reconciliation.occurrence_date = p_occurrence_date
    and allocation ->> 'type' = 'extra_principal'
    and allocation ->> 'targetId' = p_debt_id;

  v_remaining := greatest(0, v_plan_amount - v_prior_amount);
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
    'matchReason', v_tx.match_reason
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
      linked_plan_id = v_payment.id,
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

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, 'snowball',
    v_payment.id, p_occurrence_date, p_settlement, v_remaining, v_allocations,
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

revoke execute on function public.reconcile_snowball_transaction(
  text, text, date, numeric, text, text
) from public, anon;
grant execute on function public.reconcile_snowball_transaction(
  text, text, date, numeric, text, text
) to authenticated, service_role;

create or replace function public.restore_snowball_reconciliation_on_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  allocation jsonb;
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

  return old;
end;
$$;

drop trigger if exists restore_snowball_reconciliation_on_delete
  on public.transaction_reconciliations;
create trigger restore_snowball_reconciliation_on_delete
after delete on public.transaction_reconciliations
for each row execute function public.restore_snowball_reconciliation_on_delete();

revoke execute on function public.restore_snowball_reconciliation_on_delete() from public, anon, authenticated;
