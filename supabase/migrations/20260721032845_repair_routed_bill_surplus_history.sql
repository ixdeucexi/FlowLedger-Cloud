-- Older Activity matches could route a lower bill remainder to Snowball while
-- leaving the reconciliation marked partial. Link those funding sources to
-- their review and make the bill settlement reflect the user's full-payment
-- choice.
with candidate_sources as (
  select distinct on (payment.id, source.ordinality)
    payment.id as payment_id,
    source.ordinality,
    reconciliation.transaction_id
  from public.extra_payments payment
  cross join lateral jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb))
    with ordinality as source(value, ordinality)
  join public.transaction_reconciliations reconciliation
    on reconciliation.resolution = 'bill'
    and reconciliation.target_id = source.value ->> 'billId'
  join public.transactions transaction
    on transaction.id = reconciliation.transaction_id
  where source.value ->> 'type' = 'bill_surplus'
    and nullif(source.value ->> 'reviewTransactionId', '') is null
    and extract(year from transaction.date::date)::integer = payment.year
    and extract(month from transaction.date::date)::integer - 1 = payment.month
    and abs(
      reconciliation.planned_amount
      - abs(transaction.amount)
      - coalesce((source.value ->> 'amount')::numeric, 0)
    ) < 0.01
  order by payment.id, source.ordinality, reconciliation.reviewed_at desc
), rebuilt_sources as (
  select
    payment.id,
    jsonb_agg(
      case
        when candidate.transaction_id is not null then
          source.value || jsonb_build_object('reviewTransactionId', candidate.transaction_id)
        else source.value
      end
      order by source.ordinality
    ) as sources
  from public.extra_payments payment
  cross join lateral jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb))
    with ordinality as source(value, ordinality)
  left join candidate_sources candidate
    on candidate.payment_id = payment.id
    and candidate.ordinality = source.ordinality
  where exists (
    select 1 from candidate_sources found where found.payment_id = payment.id
  )
  group by payment.id
)
update public.extra_payments payment
set sources = rebuilt.sources
from rebuilt_sources rebuilt
where payment.id = rebuilt.id;

with routed_reviews as (
  select distinct source.value ->> 'reviewTransactionId' as transaction_id
  from public.extra_payments payment
  cross join lateral jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source(value)
  where source.value ->> 'type' = 'bill_surplus'
    and nullif(source.value ->> 'reviewTransactionId', '') is not null
)
update public.transaction_reconciliations reconciliation
set settlement = 'full',
    allocations = (
      select jsonb_agg(
        case
          when allocation.value ->> 'type' = 'bill' then
            allocation.value || jsonb_build_object('settlement', 'full')
          else allocation.value
        end
        order by allocation.ordinality
      )
      from jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb))
        with ordinality as allocation(value, ordinality)
    ),
    updated_at = now()
where reconciliation.transaction_id in (select transaction_id from routed_reviews)
  and reconciliation.resolution = 'bill';

with routed_reviews as (
  select distinct source.value ->> 'reviewTransactionId' as transaction_id
  from public.extra_payments payment
  cross join lateral jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source(value)
  where source.value ->> 'type' = 'bill_surplus'
    and nullif(source.value ->> 'reviewTransactionId', '') is not null
)
update public.transactions transaction
set review_allocations = (
      select jsonb_agg(
        case
          when allocation.value ->> 'type' = 'bill' then
            allocation.value || jsonb_build_object('settlement', 'full')
          else allocation.value
        end
        order by allocation.ordinality
      )
      from jsonb_array_elements(coalesce(transaction.review_allocations, '[]'::jsonb))
        with ordinality as allocation(value, ordinality)
    )
where transaction.id in (select transaction_id from routed_reviews)
  and transaction.review_resolution = 'bill';

with routed_reviews as (
  select distinct source.value ->> 'reviewTransactionId' as transaction_id
  from public.extra_payments payment
  cross join lateral jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source(value)
  where source.value ->> 'type' = 'bill_surplus'
    and nullif(source.value ->> 'reviewTransactionId', '') is not null
)
update public.bill_transaction_matches match
set settlement = 'full'
where match.transaction_id in (select transaction_id from routed_reviews);

with routed_override_ids as (
  select distinct match.override_id
  from public.bill_transaction_matches match
  join public.extra_payments payment
    on exists (
      select 1
      from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source(value)
      where source.value ->> 'type' = 'bill_surplus'
        and source.value ->> 'reviewTransactionId' = match.transaction_id
    )
), routed_overrides as (
  select
    routed.override_id,
    (
      select coalesce(sum(month_match.matched_amount), 0)
      from public.bill_transaction_matches month_match
      where month_match.override_id = routed.override_id
    ) as actual_total
  from routed_override_ids routed
)
update public.monthly_overrides override
set custom_amount = routed.actual_total
from routed_overrides routed
where override.id = routed.override_id;

-- Undoing a lower full-payment match must also release the temporary monthly
-- amount created by that match. This prevents a later partial redo from
-- inheriting a stale closed amount.
create or replace function public.restore_bill_custom_amount_after_review_undo()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_transaction_date date;
  v_month integer;
  v_year integer;
  v_remaining_total numeric := 0;
  v_has_remaining_lower_full boolean := false;
begin
  if old.resolution <> 'bill' or old.target_id is null then
    return old;
  end if;

  select transaction.date::date
  into v_transaction_date
  from public.transactions transaction
  where transaction.id = old.transaction_id;

  if v_transaction_date is null then
    return old;
  end if;
  v_month := extract(month from v_transaction_date)::integer - 1;
  v_year := extract(year from v_transaction_date)::integer;

  select
    coalesce(sum(match.matched_amount), 0),
    coalesce(bool_or(
      reconciliation.settlement = 'full'
      and reconciliation.planned_amount > match.matched_amount + 0.005
    ), false)
  into v_remaining_total, v_has_remaining_lower_full
  from public.bill_transaction_matches match
  left join public.transaction_reconciliations reconciliation
    on reconciliation.transaction_id = match.transaction_id
  where match.bill_id = old.target_id
    and match.match_month = v_month
    and match.match_year = v_year;

  update public.monthly_overrides override
  set custom_amount = case
    when v_has_remaining_lower_full then v_remaining_total
    else null
  end
  where override.bill_id = old.target_id
    and override.month = v_month
    and override.year = v_year;

  return old;
end;
$$;

revoke execute on function public.restore_bill_custom_amount_after_review_undo()
from public, anon, authenticated;

drop trigger if exists transaction_reconciliations_restore_bill_custom_amount
on public.transaction_reconciliations;
create trigger transaction_reconciliations_restore_bill_custom_amount
after delete on public.transaction_reconciliations
for each row
execute function public.restore_bill_custom_amount_after_review_undo();

comment on function public.restore_bill_custom_amount_after_review_undo() is
  'Clears or recalculates a lower full-payment monthly amount after its reconciliation is undone.';
