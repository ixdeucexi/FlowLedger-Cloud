-- Plaid can return the same posted activity through two connected accounts.
-- Once one copy is reviewed, keep that reviewed row as the single cash event
-- and hide exact cross-account mirrors. The hidden rows remain reversible.

create temp table plaid_mirror_drops on commit drop as
with candidates as (
  select
    t.*,
    btrim(lower(regexp_replace(
      coalesce(nullif(t.merchant_name, ''), nullif(t.note, ''), t.category, ''),
      '[^[:alnum:]]+', ' ', 'g'
    ))) as description_key
  from public.transactions t
  where t.source = 'plaid'
    and t.pending is not true
    and t.removed_at is null
    and t.plaid_account_id is not null
    and t.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and date_trunc('month', t.date::date) = date_trunc('month', current_date)
), eligible_groups as (
  select household_id, budget_id, date, amount, description_key
  from candidates
  where description_key <> ''
  group by household_id, budget_id, date, amount, description_key
  having count(*) > 1
    and count(distinct plaid_account_id) > 1
    and bool_or(review_status in ('matched', 'categorized', 'transfer') and reviewed_at is not null)
    and bool_and(review_resolution is null or review_resolution in ('bill', 'category', 'transfer'))
), ranked as (
  select
    c.id,
    first_value(c.id) over (
      partition by c.household_id, c.budget_id, c.date, c.amount, c.description_key
      order by
        case when c.review_status in ('matched', 'categorized', 'transfer') and c.reviewed_at is not null then 0 else 1 end,
        c.reviewed_at desc nulls last,
        c.id
    ) as winner_id,
    row_number() over (
      partition by c.household_id, c.budget_id, c.date, c.amount, c.description_key
      order by
        case when c.review_status in ('matched', 'categorized', 'transfer') and c.reviewed_at is not null then 0 else 1 end,
        c.reviewed_at desc nulls last,
        c.id
    ) as duplicate_rank
  from candidates c
  join eligible_groups g
    on g.household_id is not distinct from c.household_id
   and g.budget_id is not distinct from c.budget_id
   and g.date = c.date
   and g.amount = c.amount
   and g.description_key = c.description_key
)
select winner_id, id as drop_id
from ranked
where duplicate_rank > 1;

create temp table plaid_mirror_match_drops on commit drop as
select m.*
from public.bill_transaction_matches m
join plaid_mirror_drops d on d.drop_id = m.transaction_id;

with grouped as (
  select winner_id, jsonb_agg(drop_id order by drop_id) as mirror_ids
  from plaid_mirror_drops
  group by winner_id
)
update public.transaction_reconciliations r
set restore_snapshot = jsonb_set(
  coalesce(r.restore_snapshot, '{}'::jsonb),
  '{suppressedMirrorIds}',
  coalesce(r.restore_snapshot->'suppressedMirrorIds', '[]'::jsonb) || grouped.mirror_ids,
  true
)
from grouped
where r.transaction_id = grouped.winner_id;

delete from public.transaction_reconciliations r
using plaid_mirror_drops d
where r.transaction_id = d.drop_id;

delete from public.bill_transaction_matches m
using plaid_mirror_drops d
where m.transaction_id = d.drop_id;

update public.transactions t
set removed_at = now(),
    linked_bill_id = null,
    linked_income_id = null,
    linked_plan_id = null,
    linked_plan_type = null,
    matched_occurrence_date = null,
    match_confidence = null,
    match_reason = null,
    review_status = 'legacy_reviewed',
    review_resolution = null,
    review_allocations = '[]'::jsonb,
    reviewed_at = null,
    reviewed_by = null
from plaid_mirror_drops d
where t.id = d.drop_id;

with affected as (
  select
    override_id,
    (array_agg(baseline_paid_amount order by created_at, transaction_id))[1] as baseline_paid_amount,
    (array_agg(baseline_actual_amount order by created_at, transaction_id))[1] as baseline_actual_amount,
    (array_agg(baseline_paid_date order by created_at, transaction_id))[1] as baseline_paid_date
  from plaid_mirror_match_drops
  group by override_id
), totals as (
  select
    a.override_id,
    count(m.transaction_id) as match_count,
    coalesce(sum(m.matched_amount), 0) as matched_total,
    max(m.transaction_date) as latest_date,
    a.baseline_paid_amount,
    a.baseline_actual_amount,
    a.baseline_paid_date
  from affected a
  left join public.bill_transaction_matches m on m.override_id = a.override_id
  group by a.override_id, a.baseline_paid_amount, a.baseline_actual_amount, a.baseline_paid_date
)
update public.monthly_overrides o
set paid_amount = case when totals.match_count > 0 then totals.matched_total else totals.baseline_paid_amount end,
    actual_amount = case when totals.match_count > 0 then totals.matched_total else totals.baseline_actual_amount end,
    paid_date = case when totals.match_count > 0 then totals.latest_date else totals.baseline_paid_date end
from totals
where o.id = totals.override_id;

create or replace function public.suppress_plaid_mirrors_after_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_winner public.transactions%rowtype;
  v_description_key text;
  v_mirror_ids jsonb;
begin
  select * into v_winner
  from public.transactions
  where id = new.transaction_id;

  if not found
    or v_winner.source <> 'plaid'
    or v_winner.pending is true
    or v_winner.removed_at is not null
    or v_winner.plaid_account_id is null then
    return new;
  end if;

  v_description_key := btrim(lower(regexp_replace(
    coalesce(nullif(v_winner.merchant_name, ''), nullif(v_winner.note, ''), v_winner.category, ''),
    '[^[:alnum:]]+', ' ', 'g'
  )));
  if v_description_key = '' then return new; end if;

  with suppressed as (
    update public.transactions d
    set removed_at = now(),
        review_status = 'legacy_reviewed',
        review_resolution = null,
        review_allocations = '[]'::jsonb,
        reviewed_at = null,
        reviewed_by = null
    where d.id <> v_winner.id
      and d.source = 'plaid'
      and d.pending is not true
      and d.removed_at is null
      and d.household_id is not distinct from v_winner.household_id
      and d.budget_id is not distinct from v_winner.budget_id
      and d.date = v_winner.date
      and d.amount = v_winner.amount
      and d.plaid_account_id is not null
      and d.plaid_account_id is distinct from v_winner.plaid_account_id
      and d.review_status in ('needs_review', 'legacy_reviewed')
      and d.reviewed_at is null
      and d.linked_bill_id is null
      and d.linked_income_id is null
      and d.linked_plan_id is null
      and not exists (
        select 1 from public.transaction_reconciliations existing
        where existing.transaction_id = d.id
      )
      and btrim(lower(regexp_replace(
        coalesce(nullif(d.merchant_name, ''), nullif(d.note, ''), d.category, ''),
        '[^[:alnum:]]+', ' ', 'g'
      ))) = v_description_key
    returning d.id
  )
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into v_mirror_ids
  from suppressed;

  if jsonb_array_length(v_mirror_ids) > 0 then
    update public.transaction_reconciliations
    set restore_snapshot = jsonb_set(
      coalesce(restore_snapshot, '{}'::jsonb),
      '{suppressedMirrorIds}',
      coalesce(restore_snapshot->'suppressedMirrorIds', '[]'::jsonb) || v_mirror_ids,
      true
    )
    where transaction_id = new.transaction_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.suppress_plaid_mirrors_after_review() from public, anon, authenticated, service_role;

drop trigger if exists suppress_plaid_mirrors_after_review on public.transaction_reconciliations;
create trigger suppress_plaid_mirrors_after_review
after insert on public.transaction_reconciliations
for each row execute function public.suppress_plaid_mirrors_after_review();

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
  v_mirror_id text;
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

  for v_mirror_id in
    select jsonb_array_elements_text(coalesce(v_snapshot->'suppressedMirrorIds', '[]'::jsonb))
  loop
    update public.transactions set
      removed_at = null,
      review_status = case
        when source = 'plaid'
          and pending is not true
          and date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and date_trunc('month', date::date) = date_trunc('month', current_date)
        then 'needs_review'
        else 'legacy_reviewed'
      end,
      review_resolution = null,
      review_allocations = '[]'::jsonb,
      reviewed_at = null,
      reviewed_by = null
    where id = v_mirror_id;
  end loop;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'needs_review');
end;
$$;

revoke execute on function public.undo_transaction_reconciliation(text) from public, anon;
grant execute on function public.undo_transaction_reconciliation(text) to authenticated, service_role;
