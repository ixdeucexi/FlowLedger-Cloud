-- Create a post-purchase spending bucket and reconcile its posted bank charge
-- in one database transaction. The posted row lock makes double taps and
-- retries serialize; only the first needs_review request can succeed.

create or replace function private.create_spending_bucket_for_transaction(
  p_transaction_id text,
  p_goal_id text,
  p_name text,
  p_target_amount numeric,
  p_target_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_goal public.goals%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_name text;
  v_actual numeric;
  v_target numeric;
  v_settlement text;
  v_reconciliation jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to create a spending bucket';
  end if;

  if nullif(btrim(coalesce(p_goal_id, '')), '') is null
    or length(p_goal_id) > 128
    or p_goal_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'A valid spending bucket id is required';
  end if;
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then raise exception 'Enter a name for this spending bucket'; end if;
  if length(v_name) > 120 then raise exception 'Keep the spending bucket name to 120 characters or fewer'; end if;
  if p_target_date is null then raise exception 'Choose a valid target date'; end if;
  if p_target_amount is null
    or lower(p_target_amount::text) in ('nan', 'infinity', '-infinity')
    or p_target_amount <= 0 then
    raise exception 'Enter a positive spending bucket amount';
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
  if v_tx.amount >= 0 then raise exception 'Only money-out transactions can create a spending bucket'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_tx.household_id and hp.tier = 'pro'
  ) then
    raise exception 'Review Center requires the Pro plan';
  end if;

  v_actual := round(abs(v_tx.amount), 2);
  v_target := round(p_target_amount, 2);
  if lower(v_actual::text) in ('nan', 'infinity', '-infinity')
    or lower(v_target::text) in ('nan', 'infinity', '-infinity') then
    raise exception 'Enter a finite spending bucket amount';
  end if;
  if v_target < v_actual then
    raise exception 'Bucket amount must be at least $% to include this transaction', to_char(v_actual, 'FM999999999990.00');
  end if;
  v_settlement := case when v_target = v_actual then 'exact' else 'partial' end;

  -- The RPC may have committed even if the client lost its response. A retry
  -- can carry a new proposed goal id, so recover by the locked transaction's
  -- authoritative linked goal and require the full original request to match.
  if v_tx.review_status is distinct from 'needs_review' then
    if v_tx.review_status = 'matched'
      and v_tx.review_resolution = 'goal'
      and v_tx.linked_plan_type = 'goal'
      and nullif(v_tx.linked_plan_id, '') is not null
      and v_tx.matched_occurrence_date = p_target_date then
      select * into v_existing
      from public.transaction_reconciliations
      where transaction_id = p_transaction_id
      for update;
      select * into v_goal
      from public.goals
      where id = v_tx.linked_plan_id
      for update;

      if v_existing.transaction_id = p_transaction_id
        and v_existing.resolution = 'goal'
        and v_existing.target_id = v_goal.id
        and v_existing.occurrence_date = p_target_date
        and round(v_existing.planned_amount, 2) = v_target
        and v_existing.settlement = v_settlement
        and v_goal.user_id = v_tx.user_id
        and v_goal.household_id is not distinct from v_tx.household_id
        and v_goal.budget_id is not distinct from v_tx.budget_id
        and v_goal.goal_type = 'planned_expense'
        and btrim(v_goal.name) = v_name
        and round(v_goal.target_amount, 2) = v_target
        and v_goal.target_date::date = p_target_date
        and jsonb_array_length(coalesce(v_existing.allocations, '[]'::jsonb)) = 1
        and exists (
          select 1
          from jsonb_array_elements(coalesce(v_existing.allocations, '[]'::jsonb)) allocation
          where allocation ->> 'type' = 'planned_expense'
            and allocation ->> 'source' = 'goal'
            and allocation ->> 'targetId' = v_goal.id
            and round((allocation ->> 'amount')::numeric, 2) = v_actual
            and round((allocation ->> 'plannedAmount')::numeric, 2) = v_target
            and (allocation ->> 'occurrenceDate')::date = p_target_date
            and allocation ->> 'settlement' = v_settlement
        ) then
        return jsonb_build_object(
          'goal_id', v_goal.id,
          'goal', to_jsonb(v_goal),
          'reconciliation', to_jsonb(v_existing),
          'retry', true
        );
      end if;
    end if;
    raise exception 'This transaction has already been reviewed with different details';
  end if;

  if exists (select 1 from public.goals where id = p_goal_id) then
    raise exception 'That spending bucket id is already in use';
  end if;

  insert into public.goals (
    id, user_id, household_id, budget_id, name, target_amount, target_date,
    current_amount, created_at, goal_type
  ) values (
    p_goal_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, v_name,
    v_target, p_target_date::text, 0, v_now::text, 'planned_expense'
  )
  returning * into v_goal;

  v_reconciliation := private.reconcile_transaction(
    p_transaction_id,
    'goal',
    p_goal_id,
    p_target_date,
    v_target,
    v_settlement,
    null
  );

  select * into v_goal from public.goals where id = p_goal_id;
  return jsonb_build_object(
    'goal_id', p_goal_id,
    'goal', to_jsonb(v_goal),
    'reconciliation', v_reconciliation
  );
end;
$$;

revoke all on function private.create_spending_bucket_for_transaction(text, text, text, numeric, date)
  from public, anon;
grant execute on function private.create_spending_bucket_for_transaction(text, text, text, numeric, date)
  to authenticated, service_role;

create or replace function public.create_spending_bucket_for_transaction(
  p_transaction_id text,
  p_goal_id text,
  p_name text,
  p_target_amount numeric,
  p_target_date date
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_spending_bucket_for_transaction(
    p_transaction_id,
    p_goal_id,
    p_name,
    p_target_amount,
    p_target_date
  )
$$;

revoke all on function public.create_spending_bucket_for_transaction(text, text, text, numeric, date)
  from public, anon;
grant execute on function public.create_spending_bucket_for_transaction(text, text, text, numeric, date)
  to authenticated, service_role;

comment on function public.create_spending_bucket_for_transaction(text, text, text, numeric, date) is
  'Atomically creates an open planned-expense bucket and applies one needs-review posted money-out transaction.';
