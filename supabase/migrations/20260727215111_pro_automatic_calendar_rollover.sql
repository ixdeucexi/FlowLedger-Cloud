-- Pro automation: keep unfinished scheduled bill occurrences on today's calendar.
-- The recurring schedule remains unchanged; bill_date_moves only moves the specific
-- overdue occurrence. Actual/imported transactions are completed activity and are
-- intentionally never moved.

create extension if not exists pg_cron;
alter table public.household_settings
  add column if not exists time_zone text not null default 'UTC',
  add column if not exists automatic_rollover_started_on date not null default current_date;
alter table public.bill_date_moves
  add column if not exists move_reason text not null default 'manual';
alter table public.bill_date_moves
  drop constraint if exists bill_date_moves_move_reason_check;
alter table public.bill_date_moves
  add constraint bill_date_moves_move_reason_check
  check (move_reason in ('manual', 'automatic'));
comment on column public.household_settings.time_zone is
  'IANA time zone used by Pro calendar automation to determine the household local date.';
comment on column public.household_settings.automatic_rollover_started_on is
  'First local date eligible for Pro automatic calendar rollover. Prevents historical backfill.';
comment on column public.bill_date_moves.move_reason is
  'Whether an occurrence was moved by a household editor or Pro automation.';
create or replace function private.rollover_pro_calendar_for_household(
  p_household_id uuid,
  p_local_today date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_moved integer := 0;
begin
  if p_household_id is null or p_local_today is null then
    return jsonb_build_object('moved', 0);
  end if;

  if not exists (
    select 1
    from public.household_plans as plan
    where plan.household_id = p_household_id
      and plan.tier = 'pro'
  ) then
    return jsonb_build_object('moved', 0);
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
      bill.frequency,
      bill.due_day,
      bill.day_of_week,
      bill.next_payment_date,
      bill.start_date,
      bill.end_date,
      generated.occurrence_date,
      override.id as override_id,
      override.custom_amount,
      override.custom_due_day,
      override.paid_amount,
      override.actual_amount,
      override.paid_date
    from household_scope as scope
    join public.bills as bill
      on bill.household_id = scope.household_id
     and (scope.budget_id is null or bill.budget_id = scope.budget_id)
     and (bill.is_recurring or bill.is_debt)
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
    where
      (
        bill.start_date is null
        or date_trunc('month', generated.occurrence_date)
          >= date_trunc('month', nullif(bill.start_date, '')::date)
      )
      and (
        bill.end_date is null
        or date_trunc('month', generated.occurrence_date)
          <= date_trunc('month', nullif(bill.end_date, '')::date)
      )
      and (
        (
          bill.frequency = 'monthly'
          and extract(day from generated.occurrence_date)::integer = least(
            greatest(coalesce(override.custom_due_day, bill.due_day, 1), 1),
            extract(day from (
              date_trunc('month', generated.occurrence_date)
              + interval '1 month - 1 day'
            ))::integer
          )
        )
        or (
          bill.frequency = 'weekly'
          and extract(dow from generated.occurrence_date)::integer = coalesce(
            bill.day_of_week,
            extract(dow from nullif(bill.next_payment_date, '')::date)::integer,
            0
          )
        )
        or (
          bill.frequency = 'biweekly'
          and (
            (
              coalesce(nullif(bill.next_payment_date, ''), nullif(bill.start_date, '')) is not null
              and mod(
                generated.occurrence_date::date
                  - coalesce(
                    nullif(bill.next_payment_date, '')::date,
                    nullif(bill.start_date, '')::date
                  ),
                14
              ) = 0
            )
            or (
              coalesce(nullif(bill.next_payment_date, ''), nullif(bill.start_date, '')) is null
              and extract(day from generated.occurrence_date)::integer = least(
                greatest(coalesce(bill.due_day, 1), 1),
                extract(day from (
                  date_trunc('month', generated.occurrence_date)
                  + interval '1 month - 1 day'
                ))::integer
              )
            )
          )
        )
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
  select count(*) into v_moved from moved;

  return jsonb_build_object(
    'household_id', p_household_id,
    'local_date', p_local_today,
    'moved', v_moved
  );
end;
$function$;
create or replace function private.run_pro_calendar_rollover(
  p_run_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  household record;
  result jsonb;
  v_households integer := 0;
  v_moved integer := 0;
begin
  for household in
    select
      plan.household_id,
      (
        p_run_at at time zone coalesce(
          (
            select zone.name
            from pg_catalog.pg_timezone_names as zone
            where zone.name = settings.time_zone
            limit 1
          ),
          'UTC'
        )
      )::date as local_today
    from public.household_plans as plan
    join public.household_settings as settings
      on settings.household_id = plan.household_id
    where plan.tier = 'pro'
  loop
    result := private.rollover_pro_calendar_for_household(
      household.household_id,
      household.local_today
    );
    v_households := v_households + 1;
    v_moved := v_moved + coalesce((result->>'moved')::integer, 0);
  end loop;

  return jsonb_build_object(
    'households_checked', v_households,
    'moved', v_moved,
    'ran_at', p_run_at
  );
end;
$function$;
create or replace function public.rollover_my_pro_calendar(
  p_household_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_time_zone text;
  v_local_today date;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to run calendar automation';
  end if;

  if not public.is_household_member(p_household_id) then
    raise exception 'Household access is required';
  end if;

  if not exists (
    select 1
    from public.household_plans as plan
    where plan.household_id = p_household_id
      and plan.tier = 'pro'
  ) then
    return jsonb_build_object('moved', 0, 'plan', 'free');
  end if;

  select coalesce(
    (
      select zone.name
      from pg_catalog.pg_timezone_names as zone
      where zone.name = settings.time_zone
      limit 1
    ),
    'UTC'
  )
  into v_time_zone
  from public.household_settings as settings
  where settings.household_id = p_household_id;

  v_local_today := (now() at time zone coalesce(v_time_zone, 'UTC'))::date;

  return private.rollover_pro_calendar_for_household(
    p_household_id,
    v_local_today
  );
end;
$function$;
revoke all on function private.rollover_pro_calendar_for_household(uuid, date)
  from public, anon, authenticated;
revoke all on function private.run_pro_calendar_rollover(timestamptz)
  from public, anon, authenticated;
revoke all on function public.rollover_my_pro_calendar(uuid)
  from public, anon;
grant execute on function public.rollover_my_pro_calendar(uuid)
  to authenticated, service_role;
select cron.schedule(
  'flowledger-pro-calendar-rollover',
  '5 * * * *',
  'select private.run_pro_calendar_rollover();'
);
