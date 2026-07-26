-- Keep one Snowball plan row while its future payment date moves. The stable
-- payment id prevents a move from creating a second plan in the destination
-- month and leaves ordinary bank/manual transactions untouched.
create or replace function public.apply_debt_snowball_payment(
  p_payment_id text,
  p_month integer,
  p_year integer,
  p_amount numeric,
  p_payment_date date,
  p_allocations jsonb,
  p_sources jsonb,
  p_household_id uuid default null,
  p_apply_now boolean default false
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_id text;
  v_payment_id text;
  v_old_month integer;
  v_old_year integer;
  v_old_allocations jsonb := '[]'::jsonb;
  v_old_sources jsonb := '[]'::jsonb;
  v_old_applied boolean := false;
  v_override_id text;
  v_change record;
  v_budget_id uuid;
  v_allocation_total numeric;
  v_plan_sources jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if p_month < 0 or p_month > 11 or extract(year from p_payment_date)::integer <> p_year
     or extract(month from p_payment_date)::integer <> p_month + 1 then
    raise exception 'Payment date must stay in the selected Snowball month';
  end if;
  if p_amount <= 0 or jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'A positive Snowball payment and allocations are required';
  end if;

  select coalesce(sum((item ->> 'payment')::numeric), 0)
  into v_allocation_total
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) item;
  if abs(v_allocation_total - p_amount) >= 0.01 then
    raise exception 'Snowball allocations must equal the payment amount';
  end if;

  select coalesce(
    jsonb_agg(source || jsonb_build_object('pendingBalanceApply', true)),
    '[]'::jsonb
  )
  into v_plan_sources
  from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) source;
  if jsonb_array_length(v_plan_sources) = 0 then
    v_plan_sources := jsonb_build_array(jsonb_build_object(
      'type', 'manual',
      'amount', p_amount,
      'pendingBalanceApply', true
    ));
  end if;

  if p_household_id is not null then
    select id into v_budget_id
    from public.budgets
    where household_id = p_household_id and is_default
    limit 1;
  end if;

  if p_payment_id is not null then
    select id, month, year, allocations, sources
    into v_existing_id, v_old_month, v_old_year, v_old_allocations, v_old_sources
    from public.extra_payments
    where id = p_payment_id
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    limit 1
    for update;
  end if;

  if v_existing_id is null then
    select id, month, year, allocations, sources
    into v_existing_id, v_old_month, v_old_year, v_old_allocations, v_old_sources
    from public.extra_payments
    where month = p_month
      and year = p_year
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    limit 1
    for update;
  end if;

  if v_existing_id is not null
     and (v_old_month <> p_month or v_old_year <> p_year)
     and exists (
       select 1
       from public.extra_payments destination
       where destination.id <> v_existing_id
         and destination.month = p_month
         and destination.year = p_year
         and (
           (p_household_id is not null and destination.household_id = p_household_id) or
           (p_household_id is null and destination.user_id = v_user_id)
         )
     ) then
    raise exception 'That month already has a Snowball plan';
  end if;

  v_old_applied := v_existing_id is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(v_old_sources, '[]'::jsonb)) source
    where coalesce((source ->> 'pendingBalanceApply')::boolean, false)
  );

  if v_old_applied and (v_old_month <> p_month or v_old_year <> p_year) then
    raise exception 'An applied Snowball payment cannot move to another month';
  end if;

  for v_change in
    select bill_id, round(sum(delta), 2) as delta
    from (
      select item ->> 'billId' as bill_id,
             case when p_apply_now then (item ->> 'payment')::numeric else 0 end as delta
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) item
      union all
      select item ->> 'billId' as bill_id,
             case when v_old_applied then -((item ->> 'payment')::numeric) else 0 end as delta
      from jsonb_array_elements(coalesce(v_old_allocations, '[]'::jsonb)) item
    ) changes
    group by bill_id
    having abs(sum(delta)) >= 0.005
  loop
    update public.bills
    set balance = greatest(0, balance - v_change.delta)
    where id = v_change.bill_id
      and is_debt
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      );
    if not found then raise exception 'Debt % was not found', v_change.bill_id; end if;

    select id into v_override_id
    from public.monthly_overrides
    where bill_id = v_change.bill_id
      and month = p_month
      and year = p_year
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    limit 1
    for update;

    if v_override_id is null then
      insert into public.monthly_overrides (
        id, user_id, household_id, budget_id, bill_id, month, year, paid_amount
      )
      values (
        gen_random_uuid()::text, v_user_id, p_household_id, v_budget_id,
        v_change.bill_id, p_month, p_year, greatest(0, v_change.delta)
      );
    else
      update public.monthly_overrides
      set paid_amount = greatest(0, paid_amount + v_change.delta)
      where id = v_override_id
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        );
    end if;
    v_override_id := null;
  end loop;

  if v_existing_id is null then
    v_payment_id := coalesce(p_payment_id, gen_random_uuid()::text);
    insert into public.extra_payments (
      id, user_id, household_id, budget_id, month, year,
      amount, allocations, payment_date, sources
    )
    values (
      v_payment_id, v_user_id, p_household_id, v_budget_id, p_month, p_year,
      p_amount, coalesce(p_allocations, '[]'::jsonb), p_payment_date, v_plan_sources
    )
    returning id into v_payment_id;
  else
    update public.extra_payments
    set month = p_month,
        year = p_year,
        amount = p_amount,
        allocations = coalesce(p_allocations, '[]'::jsonb),
        payment_date = p_payment_date,
        sources = v_plan_sources
    where id = v_existing_id
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    returning id into v_payment_id;
  end if;

  return v_payment_id;
end;
$$;

revoke execute on function public.apply_debt_snowball_payment(
  text, integer, integer, numeric, date, jsonb, jsonb, uuid, boolean
) from public, anon;
grant execute on function public.apply_debt_snowball_payment(
  text, integer, integer, numeric, date, jsonb, jsonb, uuid, boolean
) to authenticated;

notify pgrst, 'reload schema';
