-- Let Pro users replace a manual calendar transaction with the real posted bank
-- transaction. The manual row is retained as a reversible audit record but hidden
-- from activity and forecasts while the match is active.

alter table public.transactions
  add column if not exists replaced_transaction_id text
    references public.transactions(id) on delete set null;
create unique index if not exists transactions_one_posted_replacement_per_manual
  on public.transactions (replaced_transaction_id)
  where replaced_transaction_id is not null and removed_at is null;
alter table public.transactions
  drop constraint if exists transactions_review_resolution_check;
alter table public.transactions
  add constraint transactions_review_resolution_check
  check (
    review_resolution is null
    or review_resolution in ('bill', 'income', 'goal', 'decision', 'transaction', 'category', 'transfer', 'snowball')
  );
comment on column public.transactions.replaced_transaction_id is
  'Manual calendar transaction replaced by this reviewed posted transaction.';
create or replace function public.protect_transaction_review_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if current_user in ('postgres', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    if new.review_status <> 'legacy_reviewed'
      or new.review_resolution is not null
      or new.review_allocations <> '[]'::jsonb
      or new.reviewed_at is not null
      or new.reviewed_by is not null
      or new.linked_income_id is not null
      or new.linked_plan_id is not null
      or new.linked_plan_type is not null
      or new.matched_occurrence_date is not null
      or new.replaced_transaction_id is not null then
      raise exception 'Review state must be changed through Review Center';
    end if;
  elsif row(
    new.review_status, new.review_resolution, new.review_allocations,
    new.reviewed_at, new.reviewed_by, new.linked_income_id,
    new.linked_plan_id, new.linked_plan_type, new.matched_occurrence_date,
    new.replaced_transaction_id
  ) is distinct from row(
    old.review_status, old.review_resolution, old.review_allocations,
    old.reviewed_at, old.reviewed_by, old.linked_income_id,
    old.linked_plan_id, old.linked_plan_type, old.matched_occurrence_date,
    old.replaced_transaction_id
  ) then
    raise exception 'Review state must be changed through Review Center';
  end if;
  return new;
end;
$function$;
create or replace function public.reconcile_posted_to_manual_transaction(
  p_transaction_id text,
  p_manual_transaction_id text,
  p_occurrence_date date,
  p_planned_amount numeric,
  p_settlement text default 'exact'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_posted public.transactions%rowtype;
  v_manual public.transactions%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_planned numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to review transactions';
  end if;

  if p_transaction_id = p_manual_transaction_id then
    raise exception 'Choose a different manual transaction';
  end if;

  select * into v_posted
  from public.transactions
  where id = p_transaction_id
    and source = 'plaid'
    and pending is not true
    and removed_at is null
  for update;

  if not found then
    raise exception 'Posted transaction was not found';
  end if;

  if v_posted.household_id is null or not public.is_household_editor(v_posted.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;

  if not exists (
    select 1
    from public.household_plans as plan
    where plan.household_id = v_posted.household_id
      and plan.tier = 'pro'
  ) then
    raise exception 'Manual transaction matching requires the Pro plan';
  end if;

  select * into v_manual
  from public.transactions
  where id = p_manual_transaction_id
    and household_id = v_posted.household_id
    and budget_id is not distinct from v_posted.budget_id
    and source is distinct from 'plaid'
    and plaid_transaction_id is null
    and import_hash is null
    and transfer_group_id is null
    and linked_bill_id is null
    and linked_income_id is null
    and linked_plan_id is null
    and pending is not true
    and removed_at is null
  for update;

  if not found then
    raise exception 'Manual calendar transaction was not found';
  end if;

  if (v_posted.amount < 0) is distinct from (v_manual.amount < 0) then
    raise exception 'Money-in and money-out transactions cannot be matched';
  end if;

  if coalesce(p_settlement, '') not in ('exact', 'full') then
    raise exception 'Choose whether the posted amount replaces the manual amount';
  end if;

  if exists (
    select 1
    from public.transactions as replacement
    where replacement.replaced_transaction_id = v_manual.id
      and replacement.removed_at is null
      and replacement.id <> v_posted.id
  ) then
    raise exception 'This manual transaction is already matched';
  end if;

  select * into v_existing
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id;

  v_snapshot := case when found then v_existing.restore_snapshot else jsonb_build_object(
    'category', v_posted.category,
    'linkedBillId', v_posted.linked_bill_id,
    'linkedIncomeId', v_posted.linked_income_id,
    'linkedPlanId', v_posted.linked_plan_id,
    'linkedPlanType', v_posted.linked_plan_type,
    'matchConfidence', v_posted.match_confidence,
    'matchReason', v_posted.match_reason,
    'manualRemovedAt', v_manual.removed_at,
    'manualMatchReason', v_manual.match_reason
  ) end;

  v_actual := abs(v_posted.amount);
  v_planned := greatest(coalesce(p_planned_amount, abs(v_manual.amount)), 0);
  v_allocations := jsonb_build_array(jsonb_build_object(
    'type', 'category',
    'targetId', v_manual.id,
    'name', coalesce(nullif(btrim(v_manual.merchant_name), ''), nullif(btrim(v_manual.note), ''), v_manual.category),
    'category', v_manual.category,
    'amount', v_actual,
    'plannedAmount', v_planned,
    'occurrenceDate', coalesce(p_occurrence_date, v_manual.date::date),
    'settlement', coalesce(p_settlement, 'exact')
  ));

  update public.transactions
  set removed_at = v_now,
      match_reason = 'replaced_by_posted_transaction'
  where id = v_manual.id;

  update public.transactions
  set category = v_manual.category,
      linked_bill_id = null,
      linked_income_id = null,
      linked_plan_id = null,
      linked_plan_type = null,
      matched_occurrence_date = coalesce(p_occurrence_date, v_manual.date::date),
      replaced_transaction_id = v_manual.id,
      match_confidence = 1,
      match_reason = 'confirmed_manual_transaction_match',
      review_status = 'matched',
      review_resolution = 'transaction',
      review_allocations = v_allocations,
      reviewed_at = v_now,
      reviewed_by = (select auth.uid())
  where id = v_posted.id;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id,
    occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
    reviewed_by, reviewed_at, updated_at
  ) values (
    v_posted.id, v_posted.user_id, v_posted.household_id, v_posted.budget_id,
    'transaction', v_manual.id, coalesce(p_occurrence_date, v_manual.date::date),
    coalesce(p_settlement, 'exact'), v_planned, v_allocations, v_snapshot,
    (select auth.uid()), v_now, v_now
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
    'transaction_id', v_posted.id,
    'replaced_transaction_id', v_manual.id,
    'reviewed_at', v_now
  );
end;
$function$;
create or replace function public.undo_posted_manual_transaction_match(
  p_transaction_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_posted public.transactions%rowtype;
  v_reconciliation public.transaction_reconciliations%rowtype;
  v_snapshot jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to undo a review';
  end if;

  select * into v_posted
  from public.transactions
  where id = p_transaction_id
  for update;

  select * into v_reconciliation
  from public.transaction_reconciliations
  where transaction_id = p_transaction_id
    and resolution = 'transaction'
  for update;

  if not found or v_posted.replaced_transaction_id is null then
    raise exception 'This posted transaction is not matched to a manual transaction';
  end if;

  if v_posted.household_id is null or not public.is_household_editor(v_posted.household_id) then
    raise exception 'You need household edit access';
  end if;

  v_snapshot := v_reconciliation.restore_snapshot;

  update public.transactions
  set removed_at = case
        when v_snapshot->>'manualRemovedAt' is null then null
        else (v_snapshot->>'manualRemovedAt')::timestamptz
      end,
      match_reason = nullif(v_snapshot->>'manualMatchReason', '')
  where id = v_posted.replaced_transaction_id;

  delete from public.transaction_reconciliations
  where transaction_id = p_transaction_id;

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
      replaced_transaction_id = null,
      review_status = case
        when source = 'plaid'
          and pending is not true
          and removed_at is null
          and date_trunc('month', date::date) = date_trunc('month', current_date)
          then 'needs_review'
        else 'legacy_reviewed'
      end,
      review_resolution = null,
      review_allocations = '[]'::jsonb,
      reviewed_at = null,
      reviewed_by = null
  where id = p_transaction_id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'status', 'needs_review'
  );
end;
$function$;
revoke execute on function public.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  from public, anon;
revoke execute on function public.undo_posted_manual_transaction_match(text)
  from public, anon;
grant execute on function public.reconcile_posted_to_manual_transaction(text, text, date, numeric, text)
  to authenticated, service_role;
grant execute on function public.undo_posted_manual_transaction_match(text)
  to authenticated, service_role;
notify pgrst, 'reload schema';
