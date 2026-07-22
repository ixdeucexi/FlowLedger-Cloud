-- Make Snowball edits state-aware so moving an applied payment into the future
-- restores its debt balance in the same transaction that schedules the payment.
drop function if exists public.apply_debt_snowball_payment(text, integer, integer, numeric, date, jsonb, jsonb, uuid);

create or replace function public.apply_debt_snowball_payment(
  p_payment_id text,
  p_month integer,
  p_year integer,
  p_amount numeric,
  p_payment_date date,
  p_allocations jsonb,
  p_sources jsonb,
  p_household_id uuid default null,
  p_apply_now boolean default true
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_id text;
  v_payment_id text;
  v_old_allocations jsonb := '[]'::jsonb;
  v_old_sources jsonb := '[]'::jsonb;
  v_old_applied boolean := false;
  v_override_id text;
  v_change record;
  v_budget_id uuid;
  v_allocation_total numeric;
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

  if p_household_id is not null then
    select id into v_budget_id
      from budgets
     where household_id = p_household_id and is_default
     limit 1;
  end if;

  select id, allocations, sources
    into v_existing_id, v_old_allocations, v_old_sources
    from extra_payments
   where month = p_month
     and year = p_year
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   limit 1
   for update;

  v_old_applied := v_existing_id is not null and not exists (
    select 1
      from jsonb_array_elements(coalesce(v_old_sources, '[]'::jsonb)) source
     where coalesce((source ->> 'pendingBalanceApply')::boolean, false)
  );

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
    update bills
       set balance = greatest(0, balance - v_change.delta)
     where id = v_change.bill_id
       and is_debt
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );
    if not found then raise exception 'Debt % was not found', v_change.bill_id; end if;

    select id into v_override_id
      from monthly_overrides
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
      insert into monthly_overrides (id, user_id, household_id, budget_id, bill_id, month, year, paid_amount)
      values (gen_random_uuid()::text, v_user_id, p_household_id, v_budget_id, v_change.bill_id, p_month, p_year, greatest(0, v_change.delta));
    else
      update monthly_overrides
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
    insert into extra_payments (id, user_id, household_id, budget_id, month, year, amount, allocations, payment_date, sources)
    values (v_payment_id, v_user_id, p_household_id, v_budget_id, p_month, p_year, p_amount, coalesce(p_allocations, '[]'::jsonb), p_payment_date, coalesce(p_sources, '[]'::jsonb))
    returning id into v_payment_id;
  else
    update extra_payments
       set amount = p_amount,
           allocations = coalesce(p_allocations, '[]'::jsonb),
           payment_date = p_payment_date,
           sources = coalesce(p_sources, '[]'::jsonb)
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

revoke execute on function public.apply_debt_snowball_payment(text, integer, integer, numeric, date, jsonb, jsonb, uuid, boolean) from public, anon;
grant execute on function public.apply_debt_snowball_payment(text, integer, integer, numeric, date, jsonb, jsonb, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
