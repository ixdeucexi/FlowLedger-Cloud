-- Pro Review Center: persisted review state, allocation metadata, and atomic
-- reconciliation for bills, income, planned expenses, categories, and transfers.

alter table public.transactions add column if not exists review_status text not null default 'legacy_reviewed';
alter table public.transactions add column if not exists review_resolution text;
alter table public.transactions add column if not exists review_allocations jsonb not null default '[]'::jsonb;
alter table public.transactions add column if not exists reviewed_at timestamptz;
alter table public.transactions add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.transactions add column if not exists linked_income_id text references public.incomes(id) on delete set null;
alter table public.transactions add column if not exists linked_plan_id text;
alter table public.transactions add column if not exists linked_plan_type text;
alter table public.transactions add column if not exists matched_occurrence_date date;

alter table public.transactions drop constraint if exists transactions_review_status_check;
alter table public.transactions add constraint transactions_review_status_check
  check (review_status in ('needs_review', 'matched', 'categorized', 'transfer', 'legacy_reviewed'));
alter table public.transactions drop constraint if exists transactions_review_resolution_check;
alter table public.transactions add constraint transactions_review_resolution_check
  check (review_resolution is null or review_resolution in ('bill', 'income', 'goal', 'decision', 'category', 'transfer'));
alter table public.transactions drop constraint if exists transactions_review_allocations_array_check;
alter table public.transactions add constraint transactions_review_allocations_array_check
  check (jsonb_typeof(review_allocations) = 'array');
alter table public.transactions drop constraint if exists transactions_linked_plan_type_check;
alter table public.transactions add constraint transactions_linked_plan_type_check
  check (linked_plan_type is null or linked_plan_type in ('goal', 'decision'));

alter table public.bill_transaction_matches add column if not exists occurrence_date date;
alter table public.bill_transaction_matches add column if not exists planned_amount numeric;
alter table public.bill_transaction_matches add column if not exists settlement text;
alter table public.bill_transaction_matches drop constraint if exists bill_transaction_matches_settlement_check;
alter table public.bill_transaction_matches add constraint bill_transaction_matches_settlement_check
  check (settlement is null or settlement in ('exact', 'full', 'partial', 'split', 'extra_principal'));

create table if not exists public.transaction_reconciliations (
  transaction_id text primary key references public.transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  budget_id uuid references public.budgets(id) on delete set null,
  resolution text not null check (resolution in ('bill', 'income', 'goal', 'decision', 'category', 'transfer')),
  target_id text,
  occurrence_date date,
  settlement text check (settlement is null or settlement in ('exact', 'full', 'partial', 'split', 'extra_principal', 'regular')),
  planned_amount numeric,
  allocations jsonb not null default '[]'::jsonb check (jsonb_typeof(allocations) = 'array'),
  restore_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(restore_snapshot) = 'object'),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transaction_reconciliations_household_idx
  on public.transaction_reconciliations (household_id, reviewed_at desc);
create index if not exists transaction_reconciliations_target_idx
  on public.transaction_reconciliations (resolution, target_id, occurrence_date);

alter table public.transaction_reconciliations enable row level security;

drop policy if exists "reconciliations: household members read" on public.transaction_reconciliations;
create policy "reconciliations: household members read"
on public.transaction_reconciliations for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "reconciliations: pro editors write" on public.transaction_reconciliations;
create policy "reconciliations: pro editors write"
on public.transaction_reconciliations for all to authenticated
using (
  public.is_household_editor(household_id)
  and exists (select 1 from public.household_plans hp where hp.household_id = transaction_reconciliations.household_id and hp.tier = 'pro')
)
with check (
  public.is_household_editor(household_id)
  and exists (select 1 from public.household_plans hp where hp.household_id = transaction_reconciliations.household_id and hp.tier = 'pro')
);

-- The legacy bill-match function is security invoker. This restrictive policy
-- makes direct calls Pro-only as well as household-editor-only.
drop policy if exists "bill matches: pro households only" on public.bill_transaction_matches;
create policy "bill matches: pro households only"
on public.bill_transaction_matches as restrictive for all to authenticated
using (
  household_id is not null
  and exists (select 1 from public.household_plans hp where hp.household_id = bill_transaction_matches.household_id and hp.tier = 'pro')
)
with check (
  household_id is not null
  and exists (select 1 from public.household_plans hp where hp.household_id = bill_transaction_matches.household_id and hp.tier = 'pro')
);

grant select on public.transaction_reconciliations to authenticated;

-- Existing confirmed bill matches are already reviewed. Current-month posted
-- Plaid transactions are the initial queue; older history stays complete.
update public.transactions t
set review_status = 'matched',
    review_resolution = 'bill',
    reviewed_at = coalesce(m.created_at, now()),
    review_allocations = jsonb_build_array(jsonb_build_object(
      'type', 'bill',
      'targetId', m.bill_id,
      'amount', m.matched_amount,
      'plannedAmount', coalesce(m.planned_amount, m.matched_amount),
      'occurrenceDate', coalesce(m.occurrence_date, m.transaction_date),
      'settlement', coalesce(m.settlement, 'exact')
    )),
    matched_occurrence_date = coalesce(m.occurrence_date, m.transaction_date)
from public.bill_transaction_matches m
where m.transaction_id = t.id;

insert into public.transaction_reconciliations (
  transaction_id, user_id, household_id, budget_id, resolution, target_id,
  occurrence_date, settlement, planned_amount, allocations, restore_snapshot,
  reviewed_by, reviewed_at
)
select
  m.transaction_id, m.user_id, m.household_id, m.budget_id, 'bill', m.bill_id,
  coalesce(m.occurrence_date, m.transaction_date), coalesce(m.settlement, 'exact'),
  coalesce(m.planned_amount, m.matched_amount), t.review_allocations,
  jsonb_build_object(
    'category', m.previous_category,
    'linkedBillId', m.previous_linked_bill_id,
    'matchConfidence', m.previous_match_confidence,
    'matchReason', m.previous_match_reason
  ),
  m.user_id, coalesce(m.created_at, now())
from public.bill_transaction_matches m
join public.transactions t on t.id = m.transaction_id
where m.household_id is not null
on conflict (transaction_id) do nothing;

update public.transactions
set review_status = 'needs_review',
    review_resolution = null,
    review_allocations = '[]'::jsonb,
    reviewed_at = null,
    reviewed_by = null
where source = 'plaid'
  and pending is not true
  and removed_at is null
  and linked_bill_id is null
  and date ~ '^\\d{4}-\\d{2}-\\d{2}$'
  and date_trunc('month', date::date) = date_trunc('month', current_date);

-- Review state can only change through the atomic RPCs below. Normal manual
-- transaction edits remain available to household editors.
create or replace function public.protect_transaction_review_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
      or new.matched_occurrence_date is not null then
      raise exception 'Review state must be changed through Review Center';
    end if;
  elsif row(
    new.review_status, new.review_resolution, new.review_allocations,
    new.reviewed_at, new.reviewed_by, new.linked_income_id,
    new.linked_plan_id, new.linked_plan_type, new.matched_occurrence_date
  ) is distinct from row(
    old.review_status, old.review_resolution, old.review_allocations,
    old.reviewed_at, old.reviewed_by, old.linked_income_id,
    old.linked_plan_id, old.linked_plan_type, old.matched_occurrence_date
  ) then
    raise exception 'Review state must be changed through Review Center';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_transaction_review_state on public.transactions;
create trigger protect_transaction_review_state
before insert or update on public.transactions
for each row execute function public.protect_transaction_review_state();

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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
  v_bill public.bills%rowtype;
  v_income public.incomes%rowtype;
  v_goal public.goals%rowtype;
  v_decision public.decisions%rowtype;
  v_match public.bill_transaction_matches%rowtype;
  v_existing public.transaction_reconciliations%rowtype;
  v_actual numeric;
  v_primary numeric;
  v_extra numeric;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null then raise exception 'Sign in to review transactions'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and removed_at is null and pending is not true;
  if not found then raise exception 'Posted transaction was not found'; end if;
  if v_tx.household_id is null or not public.is_household_editor(v_tx.household_id) then
    raise exception 'You need household edit access to review transactions';
  end if;
  if not exists (select 1 from public.household_plans hp where hp.household_id = v_tx.household_id and hp.tier = 'pro') then
    raise exception 'Review Center requires the Pro plan';
  end if;
  if p_resolution not in ('bill', 'income', 'goal', 'decision', 'category', 'transfer') then
    raise exception 'Unsupported review resolution';
  end if;

  select * into v_existing from public.transaction_reconciliations where transaction_id = p_transaction_id;
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

  if p_resolution = 'category' then
    if nullif(btrim(coalesce(p_target_id, '')), '') is null then raise exception 'Choose a category'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_target_id, 'amount', v_actual));
    update public.transactions set category = p_target_id, review_status = 'categorized', review_resolution = 'category',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'transfer' then
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'transfer', 'amount', v_actual));
    update public.transactions set category = 'Transfer', review_status = 'transfer', review_resolution = 'transfer',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()),
      linked_income_id = null, linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = null
    where id = p_transaction_id;
  elsif p_resolution = 'bill' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match bills'; end if;
    select * into v_bill from public.bills where id = p_target_id;
    if not found or v_bill.household_id is distinct from v_tx.household_id or v_bill.budget_id is distinct from v_tx.budget_id then
      raise exception 'Bill does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Bill occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split', 'extra_principal') then raise exception 'Choose how this bill was paid'; end if;
    v_primary := case when p_settlement in ('split', 'extra_principal') then least(v_actual, p_planned_amount) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    if p_settlement = 'split' and (v_extra <= 0 or nullif(btrim(coalesce(p_extra_category, '')), '') is null) then
      raise exception 'Choose a category for the extra amount';
    end if;
    perform public.match_transaction_to_bill(p_transaction_id, p_target_id);
    select * into v_match from public.bill_transaction_matches where transaction_id = p_transaction_id;
    update public.bill_transaction_matches set matched_amount = v_primary, occurrence_date = p_occurrence_date,
      planned_amount = p_planned_amount, settlement = p_settlement where transaction_id = p_transaction_id;
    update public.monthly_overrides o set
      paid_amount = totals.amount,
      actual_amount = totals.amount,
      paid_date = totals.latest_date,
      custom_amount = case
        when v_bill.frequency = 'monthly' and p_settlement = 'full' and v_primary < p_planned_amount then v_primary
        else o.custom_amount
      end
    from (
      select coalesce(sum(matched_amount), 0) amount, max(transaction_date) latest_date
      from public.bill_transaction_matches
      where bill_id = p_target_id and match_month = v_match.match_month and match_year = v_match.match_year
    ) totals
    where o.id = v_match.override_id;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'bill', 'targetId', p_target_id, 'name', v_bill.name, 'category', v_bill.category,
      'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    if v_extra > 0 then
      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'type', case when p_settlement = 'extra_principal' then 'extra_principal' else 'category' end,
        'targetId', case when p_settlement = 'extra_principal' then p_target_id else null end,
        'category', case when p_settlement = 'extra_principal' then 'Debt' else p_extra_category end,
        'amount', v_extra
      ));
    end if;
    update public.transactions set review_status = 'matched', review_resolution = 'bill', review_allocations = v_allocations,
      reviewed_at = v_now, reviewed_by = (select auth.uid()), matched_occurrence_date = p_occurrence_date
    where id = p_transaction_id;
  elsif p_resolution = 'income' then
    if v_tx.amount <= 0 then raise exception 'Only deposits can match planned income'; end if;
    select * into v_income from public.incomes where id = p_target_id;
    if not found or v_income.household_id is distinct from v_tx.household_id or v_income.budget_id is distinct from v_tx.budget_id then
      raise exception 'Income does not belong to this household plan';
    end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Income occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial') then raise exception 'Choose how this income was received'; end if;
    v_allocations := jsonb_build_array(jsonb_build_object(
      'type', 'income', 'targetId', p_target_id, 'name', v_income.name, 'amount', v_actual,
      'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement
    ));
    update public.transactions set category = 'Income', linked_bill_id = null, linked_income_id = p_target_id,
      linked_plan_id = null, linked_plan_type = null, matched_occurrence_date = p_occurrence_date,
      match_confidence = 1, match_reason = 'confirmed_income_match', review_status = 'matched', review_resolution = 'income',
      review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid())
    where id = p_transaction_id;
  elsif p_resolution = 'goal' then
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_goal from public.goals where id = p_target_id and goal_type = 'planned_expense';
    if not found or v_goal.household_id is distinct from v_tx.household_id or v_goal.budget_id is distinct from v_tx.budget_id then
      raise exception 'Planned expense does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('goalCurrentAmount', v_goal.current_amount);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.goals set current_amount = case when p_settlement = 'partial' then least(target_amount, current_amount + v_primary) else target_amount end where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'goal', 'targetId', p_target_id,
      'name', v_goal.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'goal',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'goal', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  else
    if v_tx.amount >= 0 then raise exception 'Only money-out transactions can match planned expenses'; end if;
    if p_occurrence_date is null or p_planned_amount is null or p_planned_amount <= 0 then raise exception 'Planned occurrence details are required'; end if;
    if coalesce(p_settlement, '') not in ('exact', 'full', 'partial', 'split') then raise exception 'Choose how this planned expense was paid'; end if;
    if p_settlement = 'split' and nullif(btrim(coalesce(p_extra_category, '')), '') is null then raise exception 'Choose a category for the extra amount'; end if;
    select * into v_decision from public.decisions where id = p_target_id;
    if not found or v_decision.household_id is distinct from v_tx.household_id or v_decision.budget_id is distinct from v_tx.budget_id then
      raise exception 'Calendar plan does not belong to this household plan';
    end if;
    v_snapshot := v_snapshot || jsonb_build_object('decisionStatus', v_decision.status, 'decisionActualAmount', v_decision.actual_amount, 'decisionCompletedAt', v_decision.completed_at);
    v_primary := case when p_settlement = 'split' then least(v_actual, coalesce(p_planned_amount, v_actual)) else v_actual end;
    v_extra := greatest(0, v_actual - v_primary);
    update public.decisions set status = case when p_settlement = 'partial' then status else 'completed' end,
      actual_amount = v_primary, completed_at = case when p_settlement = 'partial' then completed_at else v_now end, updated_at = v_now where id = p_target_id;
    v_allocations := jsonb_build_array(jsonb_build_object('type', 'planned_expense', 'source', 'decision', 'targetId', p_target_id,
      'name', v_decision.name, 'amount', v_primary, 'plannedAmount', p_planned_amount, 'occurrenceDate', p_occurrence_date, 'settlement', p_settlement));
    if v_extra > 0 then v_allocations := v_allocations || jsonb_build_array(jsonb_build_object('type', 'category', 'category', p_extra_category, 'amount', v_extra)); end if;
    update public.transactions set linked_bill_id = null, linked_income_id = null, linked_plan_id = p_target_id, linked_plan_type = 'decision',
      matched_occurrence_date = p_occurrence_date, match_confidence = 1, match_reason = 'confirmed_plan_match', review_status = 'matched',
      review_resolution = 'decision', review_allocations = v_allocations, reviewed_at = v_now, reviewed_by = (select auth.uid()) where id = p_transaction_id;
  end if;

  insert into public.transaction_reconciliations (
    transaction_id, user_id, household_id, budget_id, resolution, target_id, occurrence_date,
    settlement, planned_amount, allocations, restore_snapshot, reviewed_by, reviewed_at, updated_at
  ) values (
    p_transaction_id, v_tx.user_id, v_tx.household_id, v_tx.budget_id, p_resolution, p_target_id,
    p_occurrence_date, coalesce(p_settlement, 'regular'), p_planned_amount, v_allocations, v_snapshot,
    (select auth.uid()), v_now, v_now
  ) on conflict (transaction_id) do update set
    resolution = excluded.resolution, target_id = excluded.target_id, occurrence_date = excluded.occurrence_date,
    settlement = excluded.settlement, planned_amount = excluded.planned_amount, allocations = excluded.allocations,
    restore_snapshot = excluded.restore_snapshot, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at;

  return jsonb_build_object('transaction_id', p_transaction_id, 'resolution', p_resolution, 'allocations', v_allocations, 'reviewed_at', v_now);
end;
$$;

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
    review_status = case when source = 'plaid' and pending is not true and removed_at is null and date_trunc('month', date::date) = date_trunc('month', current_date) then 'needs_review' else 'legacy_reviewed' end,
    review_resolution = null,
    review_allocations = '[]'::jsonb,
    reviewed_at = null,
    reviewed_by = null
  where id = p_transaction_id;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'needs_review');
end;
$$;

revoke execute on function public.reconcile_transaction(text, text, text, date, numeric, text, text) from public, anon;
revoke execute on function public.undo_transaction_reconciliation(text) from public, anon;
revoke execute on function public.match_transaction_to_bill(text, text) from authenticated;
revoke execute on function public.unmatch_transaction_from_bill(text) from authenticated;
revoke insert, update, delete on public.transaction_reconciliations from authenticated;
revoke insert, update, delete on public.bill_transaction_matches from authenticated;
grant execute on function public.reconcile_transaction(text, text, text, date, numeric, text, text) to authenticated, service_role;
grant execute on function public.undo_transaction_reconciliation(text) to authenticated, service_role;

comment on table public.transaction_reconciliations is 'Authoritative Pro Review Center resolution and allocation record for one posted transaction.';
comment on column public.transactions.review_allocations is 'Cached allocation breakdown used by Activity, Monthly, Calendar, forecasts, and reports.';
