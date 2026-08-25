-- Serialize generic Review Center decisions and make an identical client retry
-- idempotent. The legacy implementation remains private and is reachable only
-- through this locking gate.

alter function private.reconcile_transaction(text, text, text, date, numeric, text, text)
  rename to reconcile_transaction_unlocked_v1;

revoke all on function private.reconcile_transaction_unlocked_v1(text, text, text, date, numeric, text, text)
  from public, anon, authenticated;
grant execute on function private.reconcile_transaction_unlocked_v1(text, text, text, date, numeric, text, text)
  to service_role;

create or replace function private.reconcile_transaction(
  p_transaction_id text,
  p_resolution text,
  p_target_id text default null,
  p_occurrence_date date default null,
  p_planned_amount numeric default null,
  p_settlement text default null,
  p_extra_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_expected_status text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
    and deleted_at is null
  for update;
  if not found then raise exception 'Posted bank transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans plan
    where plan.household_id = v_tx.household_id and plan.tier = 'pro'
  ) then raise exception 'Review Center requires the Pro plan'; end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
  for update;

  if v_tx.review_status is distinct from 'needs_review' then
    v_expected_status := case
      when p_resolution = 'category' then 'categorized'
      when p_resolution = 'transfer' then 'transfer'
      else 'matched'
    end;
    if v_existing.transaction_id is not null
      and v_existing.resolution = p_resolution
      and v_existing.target_id is not distinct from p_target_id
      and v_existing.occurrence_date is not distinct from p_occurrence_date
      and v_existing.settlement is not distinct from coalesce(p_settlement, 'regular')
      and (
        (v_existing.planned_amount is null and p_planned_amount is null)
        or abs(v_existing.planned_amount - p_planned_amount) < 0.005
      )
      and v_tx.review_status = v_expected_status
      and v_tx.review_resolution = p_resolution
      and (case
        when p_resolution = 'goal' then v_tx.linked_plan_id = p_target_id and v_tx.linked_plan_type = 'goal'
        when p_resolution = 'decision' then v_tx.linked_plan_id = p_target_id and v_tx.linked_plan_type = 'decision'
        when p_resolution = 'bill' then v_tx.linked_bill_id = p_target_id
        when p_resolution = 'income' then v_tx.linked_income_id = p_target_id
        when p_resolution = 'category' then v_tx.category = p_target_id
        when p_resolution = 'transfer' then v_tx.category = 'Transfer'
        else false
      end)
      and (
        nullif(btrim(coalesce(p_extra_category, '')), '') is null
        or exists (
          select 1
          from jsonb_array_elements(coalesce(v_existing.allocations, '[]'::jsonb)) allocation
          where allocation ->> 'type' = 'category'
            and allocation ->> 'category' = p_extra_category
        )
      ) then
      return jsonb_build_object(
        'transaction_id', p_transaction_id,
        'resolution', v_existing.resolution,
        'allocations', v_existing.allocations,
        'reviewed_at', v_existing.reviewed_at,
        'retry', true
      );
    end if;
    raise exception 'This transaction has already been reviewed';
  end if;
  if v_existing.transaction_id is not null then
    raise exception 'This transaction review state changed. Refresh and try again';
  end if;

  -- Lock the mutable destination before the legacy implementation snapshots
  -- and changes it. Undo returns the transaction to needs_review, so a later
  -- deliberate redo takes these locks and can apply once again.
  if p_resolution = 'goal' then
    perform 1 from public.goals where id = p_target_id for update;
  elsif p_resolution = 'decision' then
    perform 1 from public.decisions where id = p_target_id for update;
  elsif p_resolution = 'bill' then
    perform 1 from public.bills where id = p_target_id for update;
  elsif p_resolution = 'income' then
    perform 1 from public.incomes where id = p_target_id for update;
  end if;

  return private.reconcile_transaction_unlocked_v1(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  );
end;
$$;

revoke all on function private.reconcile_transaction(text, text, text, date, numeric, text, text)
  from public, anon;
grant execute on function private.reconcile_transaction(text, text, text, date, numeric, text, text)
  to authenticated, service_role;

create or replace function public.reconcile_transaction(
  p_transaction_id text,
  p_resolution text,
  p_target_id text default null,
  p_occurrence_date date default null,
  p_planned_amount numeric default null,
  p_settlement text default null,
  p_extra_category text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reconcile_transaction(
    p_transaction_id,
    p_resolution,
    p_target_id,
    p_occurrence_date,
    p_planned_amount,
    p_settlement,
    p_extra_category
  )
$$;

revoke all on function public.reconcile_transaction(text, text, text, date, numeric, text, text)
  from public, anon;
grant execute on function public.reconcile_transaction(text, text, text, date, numeric, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

;
