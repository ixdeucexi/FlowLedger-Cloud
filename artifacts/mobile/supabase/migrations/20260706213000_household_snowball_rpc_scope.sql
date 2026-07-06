create extension if not exists "pgcrypto";

drop function if exists recalculate_debt_minimum_boosts();
create or replace function recalculate_debt_minimum_boosts(p_household_id uuid default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_method text := 'snowball';
  v_freed_minimum numeric := 0;
  v_target_id text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  select coalesce(hs.payment_method, s.payment_method, 'snowball') into v_method
  from (select 1) seed
  left join household_settings hs on p_household_id is not null and hs.household_id = p_household_id
  left join settings s on s.user_id = v_user_id
  limit 1;

  update bills
     set snowball_minimum_boost = 0
   where is_debt
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );

  select coalesce(sum(amount), 0) into v_freed_minimum
    from bills
   where is_debt
     and include_in_snowball is not false
     and balance <= 0.009
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );

  select id into v_target_id
    from bills
   where is_debt
     and include_in_snowball is not false
     and balance > 0.009
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   order by
     case when v_method = 'avalanche' then interest_rate end desc nulls last,
     balance asc,
     id asc
   limit 1;

  if v_target_id is not null and v_freed_minimum > 0 then
    update bills
       set snowball_minimum_boost = v_freed_minimum
     where id = v_target_id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );
  end if;
end;
$$;

notify pgrst, 'reload schema';

drop function if exists apply_debt_snowball_payment(text, integer, integer, numeric, date, jsonb, jsonb);
create or replace function apply_debt_snowball_payment(
  p_payment_id text,
  p_month integer,
  p_year integer,
  p_amount numeric,
  p_payment_date date,
  p_allocations jsonb,
  p_sources jsonb,
  p_household_id uuid default null
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
  v_override_id text;
  v_change record;
  v_budget_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  if p_household_id is not null then
    select id into v_budget_id
      from budgets
     where household_id = p_household_id and is_default
     limit 1;
  end if;

  select id, allocations
    into v_existing_id, v_old_allocations
    from extra_payments
   where month = p_month
     and year = p_year
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   limit 1
   for update;

  for v_change in
    select bill_id, round(sum(delta), 2) as delta
    from (
      select item ->> 'billId' as bill_id, (item ->> 'payment')::numeric as delta
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) item
      union all
      select item ->> 'billId' as bill_id, -((item ->> 'payment')::numeric) as delta
      from jsonb_array_elements(coalesce(v_old_allocations, '[]'::jsonb)) item
    ) changes
    group by bill_id
    having abs(sum(delta)) >= 0.005
  loop
    update bills
       set balance = greatest(0, balance - v_change.delta)
     where id = v_change.bill_id
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

drop function if exists remove_debt_snowball_payment(integer, integer);
create or replace function remove_debt_snowball_payment(
  p_month integer,
  p_year integer,
  p_household_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment_id text;
  v_allocations jsonb;
  v_item jsonb;
  v_bill_id text;
  v_payment numeric;
  v_override_id text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  select id, allocations into v_payment_id, v_allocations
    from extra_payments
   where month = p_month
     and year = p_year
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     )
   limit 1
   for update;

  if v_payment_id is null then return; end if;

  for v_item in select * from jsonb_array_elements(coalesce(v_allocations, '[]'::jsonb))
  loop
    v_bill_id := v_item ->> 'billId';
    v_payment := (v_item ->> 'payment')::numeric;

    update bills
       set balance = balance + v_payment
     where id = v_bill_id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );

    select id into v_override_id
      from monthly_overrides
     where bill_id = v_bill_id
       and month = p_month
       and year = p_year
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       )
     limit 1
     for update;

    if v_override_id is not null then
      update monthly_overrides
         set paid_amount = greatest(0, paid_amount - v_payment)
       where id = v_override_id
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         );
    end if;
    v_override_id := null;
  end loop;

  delete from extra_payments
   where id = v_payment_id
     and (
       (p_household_id is not null and household_id = p_household_id) or
       (p_household_id is null and user_id = v_user_id)
     );
end;
$$;

drop function if exists sync_due_debt_transactions(date);
create or replace function sync_due_debt_transactions(
  p_as_of_date date,
  p_household_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tx record;
  v_desired numeric;
  v_current numeric;
  v_balance numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  for v_tx in
    select *
      from transactions
     where (linked_bill_id is not null or debt_applied_bill_id is not null or debt_applied_amount > 0)
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       )
     for update
  loop
    if v_tx.debt_applied_bill_id is not null
       and v_tx.debt_applied_bill_id is distinct from v_tx.linked_bill_id
       and v_tx.debt_applied_amount > 0 then
      update bills
         set balance = balance + v_tx.debt_applied_amount
       where id = v_tx.debt_applied_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         );
      v_tx.debt_applied_amount := 0;
      v_tx.debt_applied_bill_id := null;
    end if;

    v_desired := case
      when v_tx.linked_bill_id is not null and v_tx.amount < 0 and v_tx.date <= p_as_of_date
        then abs(v_tx.amount)
      else 0
    end;
    v_current := case when v_tx.debt_applied_bill_id = v_tx.linked_bill_id then coalesce(v_tx.debt_applied_amount, 0) else 0 end;

    if v_tx.linked_bill_id is not null and v_desired > 0 then
      select balance into v_balance
        from bills
       where id = v_tx.linked_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         )
       for update;
      if v_balance is null then raise exception 'Debt % was not found', v_tx.linked_bill_id; end if;
      v_desired := least(v_desired, v_balance + v_current);
    end if;

    if v_tx.linked_bill_id is not null and abs(v_desired - v_current) >= 0.005 then
      update bills
         set balance = greatest(0, balance - (v_desired - v_current))
       where id = v_tx.linked_bill_id
         and is_debt
         and (
           (p_household_id is not null and household_id = p_household_id) or
           (p_household_id is null and user_id = v_user_id)
         );
      if not found then raise exception 'Debt % was not found', v_tx.linked_bill_id; end if;
    end if;

    update transactions
       set debt_applied_amount = v_desired,
           debt_applied_bill_id = case when v_desired > 0 then v_tx.linked_bill_id else null end
     where id = v_tx.id
       and (
         (p_household_id is not null and household_id = p_household_id) or
         (p_household_id is null and user_id = v_user_id)
       );
  end loop;

  perform recalculate_debt_minimum_boosts(p_household_id);
end;
$$;

notify pgrst, 'reload schema';
