-- Manual activity rows remain ordinary activity. Posted bank transactions are
-- reconciled only to scheduled bills, income, plans, categories, or transfers.
drop function if exists public.reconcile_posted_to_manual_transaction(text, text, date, numeric, text);
drop function if exists public.undo_posted_manual_transaction_match(text);
drop function if exists private.reconcile_posted_to_manual_transaction(text, text, date, numeric, text);
drop function if exists private.undo_posted_manual_transaction_match(text);

drop index if exists public.transactions_one_posted_replacement_per_manual;

alter table public.transactions
  drop constraint if exists transactions_review_resolution_check;

alter table public.transactions
  add constraint transactions_review_resolution_check
  check (
    review_resolution is null
    or review_resolution in ('bill', 'income', 'goal', 'decision', 'category', 'transfer', 'snowball')
  );

alter table public.transaction_reconciliations
  drop constraint if exists transaction_reconciliations_resolution_check;

alter table public.transaction_reconciliations
  add constraint transaction_reconciliations_resolution_check
  check (resolution in ('bill', 'income', 'goal', 'decision', 'category', 'transfer', 'snowball'));

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
$function$;

alter table public.transactions
  drop column if exists replaced_transaction_id;

-- Preserve the existing monthly/weekly/biweekly implementation and add a
-- quarterly pass behind the same public automation entry point.
alter function private.rollover_pro_calendar_for_household(uuid, date)
  rename to rollover_pro_calendar_standard_for_household;

create function private.rollover_pro_calendar_for_household(
  p_household_id uuid,
  p_local_today date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_standard jsonb;
  v_quarterly_moved integer := 0;
begin
  v_standard := private.rollover_pro_calendar_standard_for_household(
    p_household_id,
    p_local_today
  );

  if p_household_id is null or p_local_today is null then
    return coalesce(v_standard, jsonb_build_object('moved', 0));
  end if;

  if not exists (
    select 1
    from public.household_plans as plan
    where plan.household_id = p_household_id
      and plan.tier = 'pro'
  ) then
    return coalesce(v_standard, jsonb_build_object('moved', 0));
  end if;

  with household_scope as (
    select
      settings.household_id,
      settings.budget_id,
      least(settings.automatic_rollover_started_on, p_local_today) as started_on
    from public.household_settings as settings
    where settings.household_id = p_household_id
  ),
  possible_dates as (
    select
      bill.id as bill_id,
      bill.user_id,
      bill.household_id,
      bill.budget_id,
      bill.amount,
      bill.is_debt,
      bill.due_day,
      generated.occurrence_date,
      override.custom_amount,
      override.paid_amount,
      override.actual_amount,
      override.paid_date
    from household_scope as scope
    join public.bills as bill
      on bill.household_id = scope.household_id
     and (scope.budget_id is null or bill.budget_id = scope.budget_id)
     and (bill.is_recurring or bill.is_debt)
     and bill.frequency = 'quarterly'
    cross join lateral generate_series(
      scope.started_on::timestamp,
      (p_local_today - 1)::timestamp,
      interval '1 day'
    ) as generated(occurrence_date)
    left join public.monthly_overrides as override
      on override.bill_id = bill.id
     and override.household_id = bill.household_id
     and override.year = extract(year from generated.occurrence_date)::integer
     and override.month = extract(month from generated.occurrence_date)::integer - 1
    where coalesce(nullif(bill.next_payment_date, ''), nullif(bill.start_date, '')) is not null
      and generated.occurrence_date::date >= date_trunc(
        'month',
        coalesce(
          nullif(bill.next_payment_date, '')::date,
          nullif(bill.start_date, '')::date
        )
      )::date
      and mod(
        (
          extract(year from generated.occurrence_date)::integer * 12
          + extract(month from generated.occurrence_date)::integer
        ) - (
          extract(year from coalesce(
            nullif(bill.next_payment_date, '')::date,
            nullif(bill.start_date, '')::date
          ))::integer * 12
          + extract(month from coalesce(
            nullif(bill.next_payment_date, '')::date,
            nullif(bill.start_date, '')::date
          ))::integer
        ),
        3
      ) = 0
      and extract(day from generated.occurrence_date)::integer = least(
        greatest(coalesce(override.custom_due_day, bill.due_day, 1), 1),
        extract(day from (
          date_trunc('month', generated.occurrence_date)
          + interval '1 month - 1 day'
        ))::integer
      )
      and (
        bill.start_date is null
        or date_trunc('month', generated.occurrence_date)
          >= date_trunc('month', nullif(bill.start_date, '')::date)
      )
      and (
        bill.end_date is null
        or date_trunc('month', generated.occurrence_date)
          <= date_trunc('month', nullif(bill.end_date, '')::date)
      )
  ),
  occurrences as (
    select
      possible.*,
      coalesce(move.to_date, possible.occurrence_date::date) as visible_date,
      case
        when possible.is_debt and coalesce(possible.custom_amount, 0) <= 0.005
          then greatest(possible.amount, 0)
        else greatest(coalesce(possible.custom_amount, possible.amount), 0)
      end as expected_amount
    from possible_dates as possible
    left join public.bill_date_moves as move
      on move.household_id = possible.household_id
     and move.bill_id = possible.bill_id
     and move.from_date = possible.occurrence_date::date
  ),
  unfinished as (
    select occurrence.*
    from occurrences as occurrence
    where occurrence.visible_date < p_local_today
      and not (
        occurrence.paid_date = occurrence.visible_date
        and (
          occurrence.actual_amount is not null
          or occurrence.paid_amount >= occurrence.expected_amount - 0.005
        )
      )
      and not exists (
        select 1
        from (
          select
            coalesce(sum(
              case
                when allocation.value->>'type' = 'bill'
                  then coalesce((allocation.value->>'amount')::numeric, 0)
                else 0
              end
            ), 0) as settled_amount,
            coalesce(max(
              case
                when allocation.value->>'type' = 'bill'
                  then nullif(allocation.value->>'plannedAmount', '')::numeric
                else null
              end
            ), occurrence.expected_amount) as planned_amount,
            coalesce(bool_or(
              allocation.value->>'type' = 'bill'
              and coalesce(allocation.value->>'settlement', '') <> 'partial'
            ), false) as has_completed_allocation
          from public.transactions as transaction
          cross join lateral jsonb_array_elements(
            coalesce(transaction.review_allocations, '[]'::jsonb)
          ) as allocation(value)
          where transaction.household_id = occurrence.household_id
            and transaction.removed_at is null
            and transaction.pending is not true
            and allocation.value->>'type' = 'bill'
            and allocation.value->>'targetId' = occurrence.bill_id
            and allocation.value->>'occurrenceDate' = occurrence.visible_date::text
        ) as settlement
        where settlement.has_completed_allocation
           or settlement.settled_amount >= settlement.planned_amount - 0.005
      )
  ),
  moved as (
    insert into public.bill_date_moves (
      user_id,
      bill_id,
      from_date,
      to_date,
      household_id,
      budget_id,
      move_reason,
      created_at,
      updated_at
    )
    select
      unfinished.user_id,
      unfinished.bill_id,
      unfinished.occurrence_date::date,
      p_local_today,
      unfinished.household_id,
      unfinished.budget_id,
      'automatic',
      now(),
      now()
    from unfinished
    on conflict (household_id, bill_id, from_date)
    do update set
      to_date = excluded.to_date,
      move_reason = 'automatic',
      updated_at = now()
    where public.bill_date_moves.to_date < excluded.to_date
    returning 1
  )
  select count(*) into v_quarterly_moved from moved;

  return jsonb_set(
    coalesce(v_standard, jsonb_build_object()),
    '{moved}',
    to_jsonb(coalesce((v_standard->>'moved')::integer, 0) + v_quarterly_moved),
    true
  );
end;
$function$;

revoke all on function private.rollover_pro_calendar_standard_for_household(uuid, date)
  from public, anon, authenticated;
revoke all on function private.rollover_pro_calendar_for_household(uuid, date)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

;
