-- Keep spending-bucket closure and Snowball remainder routing in one database
-- transaction. A routed remainder is a first-class, deduplicated funding source;
-- reopening removes that source before the bucket becomes available again.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Shared households used to be protected only by the user/month key. Refuse
-- to guess which pre-existing shared plan is authoritative, then enforce one
-- canonical row per household budget and month for every future write.
do $$
begin
  if exists (
    select 1
    from public.extra_payments
    where household_id is not null
    group by household_id, coalesce(budget_id, '00000000-0000-0000-0000-000000000000'::uuid), year, month
    having count(*) > 1
  ) then
    raise exception 'Conflicting shared-household Snowball plans must be resolved before this migration can continue';
  end if;
end;
$$;

create unique index if not exists extra_payments_household_budget_month_year_idx
  on public.extra_payments (
    household_id,
    coalesce(budget_id, '00000000-0000-0000-0000-000000000000'::uuid),
    year,
    month
  )
  where household_id is not null;

create or replace function private.snowball_payment_has_reconciled_amount(
  p_payment_id text,
  p_payment_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.transaction_reconciliations reconciliation
    join public.transactions posted
      on posted.id = reconciliation.transaction_id
    cross join lateral jsonb_array_elements(coalesce(reconciliation.allocations, '[]'::jsonb)) allocation
    where reconciliation.resolution = 'snowball'
      and reconciliation.target_id = p_payment_id
      and reconciliation.occurrence_date = p_payment_date
      and posted.review_status = 'matched'
      and posted.review_resolution = 'snowball'
      and posted.linked_plan_id = p_payment_id
      and posted.matched_occurrence_date = p_payment_date
      and allocation ->> 'type' = 'extra_principal'
      and coalesce((allocation ->> 'amount')::numeric, 0) > 0
  )
$$;

revoke all on function private.snowball_payment_has_reconciled_amount(text, date)
  from public, anon, authenticated;
grant execute on function private.snowball_payment_has_reconciled_amount(text, date)
  to service_role;

create or replace function private.validate_bucket_snowball_allocations(
  p_allocations jsonb,
  p_expected_amount numeric,
  p_household_id uuid,
  p_budget_id uuid,
  p_payment_date date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allocation jsonb;
  v_bill public.bills%rowtype;
  v_total numeric;
  v_month_start date := date_trunc('month', p_payment_date)::date;
  v_month_end date := (date_trunc('month', p_payment_date) + interval '1 month - 1 day')::date;
begin
  if p_payment_date is null then
    raise exception 'Snowball payment date is required';
  end if;
  if jsonb_typeof(coalesce(p_allocations, 'null'::jsonb)) <> 'array' then
    raise exception 'Snowball allocations must be a nonempty array';
  end if;
  if jsonb_array_length(p_allocations) = 0 then
    raise exception 'Snowball allocations must be a nonempty array';
  end if;
  if p_expected_amount is null
    or lower(p_expected_amount::text) in ('nan', 'infinity', '-infinity')
    or p_expected_amount <= 0 then
    raise exception 'Snowball allocation total must be finite and positive';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_allocations) allocation
    where jsonb_typeof(allocation) <> 'object'
      or nullif(btrim(coalesce(allocation ->> 'billId', '')), '') is null
      or jsonb_typeof(allocation -> 'payment') <> 'number'
      or lower(coalesce(allocation ->> 'payment', '')) in ('nan', 'infinity', '-infinity')
  ) then
    raise exception 'Every Snowball allocation needs a debt and finite payment';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_allocations) allocation
    where case
      when jsonb_typeof(allocation -> 'payment') = 'number'
        then (allocation ->> 'payment')::numeric <= 0
      else false
    end
  ) then
    raise exception 'Every Snowball allocation payment must be positive';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_allocations) allocation
    group by allocation ->> 'billId'
    having count(*) > 1
  ) then
    raise exception 'A debt can appear in Snowball allocations only once';
  end if;

  select round(coalesce(sum((allocation ->> 'payment')::numeric), 0), 2)
  into v_total
  from jsonb_array_elements(p_allocations) allocation;
  if v_total is distinct from round(p_expected_amount, 2) then
    raise exception 'Snowball allocations must equal the payment amount';
  end if;

  for v_allocation in select allocation from jsonb_array_elements(p_allocations) allocation
  loop
    select * into v_bill
    from public.bills bill
    where bill.id = v_allocation ->> 'billId'
      and bill.household_id is not distinct from p_household_id
      and bill.budget_id is not distinct from p_budget_id
      and bill.is_debt
      and bill.include_in_snowball is not false
      and bill.balance > 0.009
      and case
        when bill.start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then bill.start_date::date <= v_month_end
        else true
      end
      and case
        when bill.end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then bill.end_date::date >= v_month_start
        else true
      end
    for update;
    if not found then
      raise exception 'Every Snowball allocation must target an active included debt in this household plan';
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_bucket_snowball_allocations(jsonb, numeric, uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function private.validate_bucket_snowball_allocations(jsonb, numeric, uuid, uuid, date)
  to service_role;

create or replace function private.close_spending_bucket_keep_available(
  p_bucket_id text,
  p_expected_spent numeric,
  p_expected_remainder numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.goals%rowtype;
  v_spent numeric;
  v_remainder numeric;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to close a spending bucket'; end if;
  select * into v_goal from public.goals where id = p_bucket_id for update;
  if not found then raise exception 'Spending bucket was not found'; end if;
  if v_goal.household_id is null or not public.is_household_editor(v_goal.household_id) then
    raise exception 'You need household edit access to close a spending bucket';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_goal.household_id and hp.tier = 'pro'
  ) then raise exception 'Spending bucket routing requires the Pro plan'; end if;
  if v_goal.goal_type is distinct from 'planned_expense' or v_goal.archived_at is not null then
    raise exception 'Only an open, active spending bucket can be closed';
  end if;

  v_spent := round(greatest(0, v_goal.current_amount), 2);
  v_remainder := round(greatest(0, v_goal.target_amount - v_goal.current_amount), 2);
  if round(coalesce(p_expected_spent, -1), 2) is distinct from v_spent
    or round(coalesce(p_expected_remainder, -1), 2) is distinct from v_remainder then
    raise exception 'This spending bucket changed. Refresh and try again';
  end if;
  if exists (
    select 1 from public.extra_payments payment
    where payment.household_id is not distinct from v_goal.household_id
      and payment.budget_id is not distinct from v_goal.budget_id
      and exists (
        select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
        where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id
      )
  ) then raise exception 'This bucket remainder is already routed to Snowball'; end if;

  if v_goal.closed_at is null then
    update public.goals
    set closed_at = now(), closed_by = (select auth.uid())
    where id = p_bucket_id
    returning * into v_goal;
  end if;
  return jsonb_build_object('goal', to_jsonb(v_goal), 'spent', v_spent, 'remainder', v_remainder, 'routed', false);
end;
$$;

create or replace function private.close_spending_bucket_and_route_remainder(
  p_bucket_id text,
  p_expected_spent numeric,
  p_expected_remainder numeric,
  p_payment_id text,
  p_month integer,
  p_year integer,
  p_payment_date date,
  p_plan_amount numeric,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.goals%rowtype;
  v_payment public.extra_payments%rowtype;
  v_existing_route public.extra_payments%rowtype;
  v_spent numeric;
  v_remainder numeric;
  v_plan_amount numeric;
  v_source_total numeric;
  v_sources jsonb;
  v_saved_payment_id text;
  v_effective_date date;
  v_route_count integer;
  v_time_zone text;
  v_local_today date;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to route a spending bucket remainder'; end if;
  select * into v_goal from public.goals where id = p_bucket_id for update;
  if not found then raise exception 'Spending bucket was not found'; end if;
  if v_goal.household_id is null or not public.is_household_editor(v_goal.household_id) then
    raise exception 'You need household edit access to route a spending bucket remainder';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_goal.household_id and hp.tier = 'pro'
  ) then raise exception 'Spending bucket routing requires the Pro plan'; end if;
  if v_goal.goal_type is distinct from 'planned_expense' or v_goal.archived_at is not null then
    raise exception 'Only an open, active spending bucket can route a remainder';
  end if;

  v_spent := round(greatest(0, v_goal.current_amount), 2);
  v_remainder := round(greatest(0, v_goal.target_amount - v_goal.current_amount), 2);
  if lower(v_spent::text) in ('nan', 'infinity', '-infinity')
    or lower(v_remainder::text) in ('nan', 'infinity', '-infinity')
    or p_plan_amount is null
    or lower(p_plan_amount::text) in ('nan', 'infinity', '-infinity')
    or p_plan_amount <= 0 then
    raise exception 'Snowball route amounts must be finite and positive';
  end if;
  if v_remainder <= 0 then raise exception 'This spending bucket has no remainder to route'; end if;
  if round(coalesce(p_expected_spent, -1), 2) is distinct from v_spent
    or round(coalesce(p_expected_remainder, -1), 2) is distinct from v_remainder then
    raise exception 'This spending bucket changed. Refresh and try again';
  end if;
  if p_payment_date is null
    or p_month < 0 or p_month > 11
    or extract(year from p_payment_date)::integer <> p_year
    or extract(month from p_payment_date)::integer <> p_month + 1 then
    raise exception 'Payment date must stay in the selected Snowball month';
  end if;

  -- A row lock cannot serialize two editors when the destination month has no
  -- plan yet. This transaction-level lock supplies the missing empty-set lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws(':', 'bucket-route', v_goal.household_id::text,
      coalesce(v_goal.budget_id::text, 'default'), p_year::text, p_month::text),
    0
  ));

  select coalesce(
    (select zone.name from pg_catalog.pg_timezone_names zone where zone.name = settings.time_zone limit 1),
    'UTC'
  ) into v_time_zone
  from public.household_settings settings
  where settings.household_id = v_goal.household_id;
  v_local_today := (now() at time zone coalesce(v_time_zone, 'UTC'))::date;
  v_effective_date := greatest(v_local_today, v_goal.target_date::date);
  if p_payment_date < v_effective_date then raise exception 'Snowball date cannot be before the bucket remainder is available'; end if;

  select count(*) into v_route_count
  from public.extra_payments payment
  where payment.household_id is not distinct from v_goal.household_id
    and payment.budget_id is not distinct from v_goal.budget_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
      where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id
    );
  if v_route_count > 1 then raise exception 'This bucket remainder has conflicting Snowball routes'; end if;

  select * into v_existing_route
  from public.extra_payments payment
  where payment.household_id is not distinct from v_goal.household_id
    and payment.budget_id is not distinct from v_goal.budget_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
      where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id
    )
  limit 1
  for update;

  if v_goal.closed_at is not null then
    if v_existing_route.id is not null
      and round(coalesce((select (source ->> 'amount')::numeric
        from jsonb_array_elements(coalesce(v_existing_route.sources, '[]'::jsonb)) source
        where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id
        limit 1), -1), 2) = v_remainder
      and v_existing_route.payment_date = p_payment_date
      and v_existing_route.allocations = p_allocations
      and round(v_existing_route.amount, 2) = round(p_plan_amount, 2) then
      return jsonb_build_object(
        'goal', to_jsonb(v_goal),
        'payment_id', v_existing_route.id,
        'payment', to_jsonb(v_existing_route),
        'remainder', v_remainder,
        'routed', true,
        'retry', true
      );
    end if;
    raise exception 'This bucket has already been closed with a different remainder choice';
  end if;
  if v_existing_route.id is not null then raise exception 'This bucket remainder is already routed to Snowball'; end if;

  if p_payment_id is not null then
    select * into v_payment from public.extra_payments
    where id = p_payment_id
      and household_id is not distinct from v_goal.household_id
      and budget_id is not distinct from v_goal.budget_id
    for update;
  end if;
  if v_payment.id is null then
    select * into v_payment from public.extra_payments
    where month = p_month and year = p_year
      and household_id is not distinct from v_goal.household_id
      and budget_id is not distinct from v_goal.budget_id
    limit 1
    for update;
  end if;
  if v_payment.id is not null and (
    private.snowball_payment_has_reconciled_amount(v_payment.id, v_payment.payment_date)
    or not exists (
    select 1 from jsonb_array_elements(coalesce(v_payment.sources, '[]'::jsonb)) source
    where coalesce((source ->> 'pendingBalanceApply')::boolean, false)
    )
  ) then raise exception 'The existing Snowball payment has already been applied'; end if;

  v_plan_amount := round(coalesce(v_payment.amount, 0) + v_remainder, 2);
  if round(coalesce(p_plan_amount, -1), 2) is distinct from v_plan_amount then
    raise exception 'The Snowball plan changed. Refresh and try again';
  end if;
  perform private.validate_bucket_snowball_allocations(
    p_allocations, v_plan_amount, v_goal.household_id, v_goal.budget_id, p_payment_date
  );

  v_sources := case
    when v_payment.id is not null and jsonb_array_length(coalesce(v_payment.sources, '[]'::jsonb)) = 0
      then jsonb_build_array(jsonb_build_object(
        'type', 'manual', 'amount', round(v_payment.amount, 2), 'pendingBalanceApply', true
      ))
    else coalesce(v_payment.sources, '[]'::jsonb)
  end || jsonb_build_array(jsonb_build_object(
    'type', 'bucket_remainder',
    'amount', v_remainder,
    'bucketId', v_goal.id,
    'bucketName', v_goal.name,
    'availableDate', v_effective_date::text,
    'pendingBalanceApply', true
  ));
  select round(coalesce(sum((source ->> 'amount')::numeric), 0), 2)
  into v_source_total from jsonb_array_elements(v_sources) source;
  if v_source_total is distinct from v_plan_amount then raise exception 'Snowball funding must equal the routed plan'; end if;

  update public.goals
  set closed_at = now(), closed_by = (select auth.uid())
  where id = p_bucket_id
  returning * into v_goal;

  perform set_config('flowledger.bucket_route_id', v_goal.id, true);
  v_saved_payment_id := public.apply_debt_snowball_payment(
    coalesce(v_payment.id, p_payment_id), p_month, p_year, v_plan_amount,
    p_payment_date, p_allocations, v_sources, v_goal.household_id, false
  );

  select * into v_payment
  from public.extra_payments
  where id = v_saved_payment_id;

  return jsonb_build_object(
    'goal', to_jsonb(v_goal),
    'payment_id', v_saved_payment_id,
    'payment', to_jsonb(v_payment),
    'remainder', v_remainder,
    'routed', true
  );
end;
$$;

create or replace function private.reopen_spending_bucket_and_unroute_remainder(
  p_bucket_id text,
  p_expected_remainder numeric,
  p_allocations jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.goals%rowtype;
  v_payment public.extra_payments%rowtype;
  v_remainder numeric;
  v_next_amount numeric;
  v_sources jsonb;
  v_route_count integer;
  v_route_amount numeric;
begin
  if (select auth.uid()) is null then raise exception 'Sign in to reopen a spending bucket'; end if;
  select * into v_goal from public.goals where id = p_bucket_id for update;
  if not found then raise exception 'Spending bucket was not found'; end if;
  if v_goal.household_id is null or not public.is_household_editor(v_goal.household_id) then
    raise exception 'You need household edit access to reopen a spending bucket';
  end if;
  if not exists (
    select 1 from public.household_plans hp
    where hp.household_id = v_goal.household_id and hp.tier = 'pro'
  ) then raise exception 'Spending bucket routing requires the Pro plan'; end if;
  if v_goal.goal_type is distinct from 'planned_expense' or v_goal.archived_at is not null then
    raise exception 'Only an active spending bucket can be reopened';
  end if;

  v_remainder := round(greatest(0, v_goal.target_amount - v_goal.current_amount), 2);
  if round(coalesce(p_expected_remainder, -1), 2) is distinct from v_remainder then
    raise exception 'This spending bucket changed. Refresh and try again';
  end if;
  select count(*) into v_route_count
  from public.extra_payments payment
  where payment.household_id is not distinct from v_goal.household_id
    and payment.budget_id is not distinct from v_goal.budget_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
      where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id
    );
  if v_route_count > 1 then raise exception 'This bucket remainder has conflicting Snowball routes'; end if;

  select * into v_payment
  from public.extra_payments payment
  where payment.household_id is not distinct from v_goal.household_id
    and payment.budget_id is not distinct from v_goal.budget_id
    and exists (
      select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
      where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id
    )
  limit 1
  for update;

  if v_goal.closed_at is null then
    if v_payment.id is not null then raise exception 'Open bucket cannot retain a routed Snowball remainder'; end if;
    return jsonb_build_object('goal', to_jsonb(v_goal), 'reopened', true, 'retry', true);
  end if;

  if v_payment.id is not null then
    select round(coalesce(sum((source ->> 'amount')::numeric), 0), 2)
    into v_route_amount
    from jsonb_array_elements(coalesce(v_payment.sources, '[]'::jsonb)) source
    where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id;
    if v_route_amount is distinct from v_remainder then
      raise exception 'The routed bucket remainder changed. Refresh and try again';
    end if;
    if private.snowball_payment_has_reconciled_amount(v_payment.id, v_payment.payment_date) then
      raise exception 'This bucket remainder has already been paid. Undo the matched Snowball transaction before reopening the bucket';
    end if;
    -- Keep the legacy applied marker as a conservative second signal for
    -- direct apply-now history that predates posted reconciliation records.
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_payment.sources, '[]'::jsonb)) source
      where not coalesce((source ->> 'pendingBalanceApply')::boolean, false)
    ) then raise exception 'This bucket remainder has already been applied. Undo the debt payment before reopening the bucket'; end if;

    select coalesce(jsonb_agg(source order by ordinal), '[]'::jsonb)
    into v_sources
    from jsonb_array_elements(coalesce(v_payment.sources, '[]'::jsonb)) with ordinality item(source, ordinal)
    where not (source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = p_bucket_id);
    select round(coalesce(sum((source ->> 'amount')::numeric), 0), 2)
    into v_next_amount from jsonb_array_elements(v_sources) source;

    if v_next_amount <= 0 then
      perform set_config('flowledger.bucket_unroute_id', p_bucket_id, true);
      delete from public.extra_payments where id = v_payment.id;
    else
      perform private.validate_bucket_snowball_allocations(
        p_allocations, v_next_amount, v_goal.household_id, v_goal.budget_id, v_payment.payment_date
      );
      perform set_config('flowledger.bucket_unroute_id', p_bucket_id, true);
      perform public.apply_debt_snowball_payment(
        v_payment.id, v_payment.month, v_payment.year, v_next_amount,
        v_payment.payment_date, p_allocations, v_sources, v_goal.household_id, false
      );
    end if;
  end if;

  update public.goals set closed_at = null, closed_by = null
  where id = p_bucket_id
  returning * into v_goal;
  return jsonb_build_object('goal', to_jsonb(v_goal), 'reopened', true, 'unrouted', v_payment.id is not null);
end;
$$;

create or replace function private.guard_bucket_remainder_payment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source jsonb;
  v_route_id text := nullif(current_setting('flowledger.bucket_route_id', true), '');
  v_unroute_id text := nullif(current_setting('flowledger.bucket_unroute_id', true), '');
  v_source_total numeric;
begin
  if tg_op = 'DELETE' then
    for v_source in
      select source
      from jsonb_array_elements(coalesce(old.sources, '[]'::jsonb)) source
      where source ->> 'type' = 'bucket_remainder'
    loop
      if v_source ->> 'bucketId' is distinct from v_unroute_id
        and exists (
          select 1 from public.goals goal
          where goal.id = v_source ->> 'bucketId' and goal.closed_at is not null
        ) then
        raise exception 'Reopen the routed spending bucket before removing this Snowball payment';
      end if;
    end loop;
    return old;
  end if;

  if jsonb_typeof(coalesce(new.sources, '[]'::jsonb)) <> 'array' then
    raise exception 'Snowball funding sources must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(new.sources, '[]'::jsonb)) source
    where source ->> 'type' = 'bucket_remainder'
    group by source ->> 'bucketId'
    having count(*) > 1
  ) then
    raise exception 'A spending bucket can fund a Snowball payment only once';
  end if;

  for v_source in
    select source
    from jsonb_array_elements(coalesce(new.sources, '[]'::jsonb)) source
    where source ->> 'type' = 'bucket_remainder'
  loop
    if nullif(btrim(coalesce(v_source ->> 'bucketId', '')), '') is null
      or jsonb_typeof(v_source -> 'amount') <> 'number'
      or lower(v_source ->> 'amount') in ('nan', 'infinity', '-infinity')
      or (v_source ->> 'amount')::numeric <= 0
      or coalesce(v_source ->> 'availableDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Routed bucket funding is invalid';
    end if;
    if new.payment_date is null or new.payment_date < (v_source ->> 'availableDate')::date then
      raise exception 'Snowball date cannot be before the routed bucket remainder is available';
    end if;
    if not exists (
      select 1 from public.goals goal
      where goal.id = v_source ->> 'bucketId'
        and goal.household_id is not distinct from new.household_id
        and goal.budget_id is not distinct from new.budget_id
        and goal.goal_type = 'planned_expense'
        and goal.closed_at is not null
        and goal.archived_at is null
    ) then
      raise exception 'Routed bucket must be closed and belong to this household plan';
    end if;
    if tg_op = 'INSERT' then
      if v_source ->> 'bucketId' is distinct from v_route_id then
        raise exception 'Use the spending bucket route action to add bucket funding';
      end if;
    elsif not exists (
      select 1
      from jsonb_array_elements(coalesce(old.sources, '[]'::jsonb)) old_source
      where old_source ->> 'type' = 'bucket_remainder'
        and old_source ->> 'bucketId' = v_source ->> 'bucketId'
    ) and v_source ->> 'bucketId' is distinct from v_route_id then
      raise exception 'Use the spending bucket route action to add bucket funding';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(coalesce(new.sources, '[]'::jsonb)) source
    where source ->> 'type' = 'bucket_remainder'
  ) then
    select round(coalesce(sum((source ->> 'amount')::numeric), 0), 2)
    into v_source_total
    from jsonb_array_elements(new.sources) source;
    if v_source_total is distinct from round(new.amount, 2) then
      raise exception 'Snowball funding sources must equal the payment amount';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if private.snowball_payment_has_reconciled_amount(old.id, old.payment_date)
      and exists (
        select 1 from jsonb_array_elements(coalesce(old.sources, '[]'::jsonb)) source
        where source ->> 'type' = 'bucket_remainder'
      )
      and row(new.amount, new.payment_date, new.allocations, new.sources, new.month, new.year)
        is distinct from row(old.amount, old.payment_date, old.allocations, old.sources, old.month, old.year) then
      raise exception 'A paid bucket-funded Snowball payment cannot be edited';
    end if;

    for v_source in
      select source
      from jsonb_array_elements(coalesce(old.sources, '[]'::jsonb)) source
      where source ->> 'type' = 'bucket_remainder'
    loop
      if v_source ->> 'bucketId' is distinct from v_unroute_id
        and exists (
          select 1 from public.goals goal
          where goal.id = v_source ->> 'bucketId' and goal.closed_at is not null
        )
        and not exists (
          select 1
          from jsonb_array_elements(coalesce(new.sources, '[]'::jsonb)) new_source
          where new_source ->> 'type' = 'bucket_remainder'
            and new_source ->> 'bucketId' = v_source ->> 'bucketId'
            and round((new_source ->> 'amount')::numeric, 2) = round((v_source ->> 'amount')::numeric, 2)
            and new_source ->> 'availableDate' = v_source ->> 'availableDate'
        ) then
        raise exception 'Reopen the routed spending bucket before changing its Snowball funding';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_bucket_remainder_payment on public.extra_payments;
create trigger guard_bucket_remainder_payment
before insert or update or delete on public.extra_payments
for each row execute function private.guard_bucket_remainder_payment();

create or replace function private.guard_routed_bucket_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
      select 1 from public.extra_payments payment
      where payment.household_id is not distinct from old.household_id
        and payment.budget_id is not distinct from old.budget_id
        and exists (
          select 1 from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
          where source ->> 'type' = 'bucket_remainder' and source ->> 'bucketId' = old.id
        )
    ) then
    if tg_op = 'DELETE' then
      raise exception 'Reopen and unroute this spending bucket before deleting it';
    end if;
    if row(
      new.name, new.target_amount, new.target_date, new.goal_type,
      new.user_id, new.household_id, new.budget_id,
      new.current_amount, new.closed_at, new.closed_by, new.archived_at, new.archived_by
    ) is distinct from row(
      old.name, old.target_amount, old.target_date, old.goal_type,
      old.user_id, old.household_id, old.budget_id,
      old.current_amount, old.closed_at, old.closed_by, old.archived_at, old.archived_by
    ) then
      raise exception 'Reopen and unroute this spending bucket before changing it';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_routed_bucket_progress on public.goals;
create trigger guard_routed_bucket_progress
before update of name, target_amount, target_date, goal_type, user_id, household_id,
  budget_id, current_amount, closed_at, closed_by, archived_at, archived_by or delete on public.goals
for each row execute function private.guard_routed_bucket_progress();

create or replace function public.close_spending_bucket_keep_available(
  p_bucket_id text,
  p_expected_spent numeric,
  p_expected_remainder numeric
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.close_spending_bucket_keep_available(p_bucket_id, p_expected_spent, p_expected_remainder) $$;

create or replace function public.close_spending_bucket_and_route_remainder(
  p_bucket_id text,
  p_expected_spent numeric,
  p_expected_remainder numeric,
  p_payment_id text,
  p_month integer,
  p_year integer,
  p_payment_date date,
  p_plan_amount numeric,
  p_allocations jsonb
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.close_spending_bucket_and_route_remainder(p_bucket_id, p_expected_spent, p_expected_remainder, p_payment_id, p_month, p_year, p_payment_date, p_plan_amount, p_allocations) $$;

create or replace function public.reopen_spending_bucket_and_unroute_remainder(
  p_bucket_id text,
  p_expected_remainder numeric,
  p_allocations jsonb default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.reopen_spending_bucket_and_unroute_remainder(p_bucket_id, p_expected_remainder, p_allocations) $$;

revoke all on function private.close_spending_bucket_keep_available(text, numeric, numeric) from public, anon;
revoke all on function private.close_spending_bucket_and_route_remainder(text, numeric, numeric, text, integer, integer, date, numeric, jsonb) from public, anon;
revoke all on function private.reopen_spending_bucket_and_unroute_remainder(text, numeric, jsonb) from public, anon;
revoke all on function private.guard_bucket_remainder_payment() from public, anon, authenticated;
revoke all on function private.guard_routed_bucket_progress() from public, anon;
grant execute on function private.close_spending_bucket_keep_available(text, numeric, numeric) to authenticated, service_role;
grant execute on function private.close_spending_bucket_and_route_remainder(text, numeric, numeric, text, integer, integer, date, numeric, jsonb) to authenticated, service_role;
grant execute on function private.reopen_spending_bucket_and_unroute_remainder(text, numeric, jsonb) to authenticated, service_role;

revoke all on function public.close_spending_bucket_keep_available(text, numeric, numeric) from public, anon;
revoke all on function public.close_spending_bucket_and_route_remainder(text, numeric, numeric, text, integer, integer, date, numeric, jsonb) from public, anon;
revoke all on function public.reopen_spending_bucket_and_unroute_remainder(text, numeric, jsonb) from public, anon;
grant execute on function public.close_spending_bucket_keep_available(text, numeric, numeric) to authenticated, service_role;
grant execute on function public.close_spending_bucket_and_route_remainder(text, numeric, numeric, text, integer, integer, date, numeric, jsonb) to authenticated, service_role;
grant execute on function public.reopen_spending_bucket_and_unroute_remainder(text, numeric, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
