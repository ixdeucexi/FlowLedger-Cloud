-- Snowball calendar entries are plans. They must not reduce a debt balance or
-- appear as paid until a separate, confirmed transaction is reconciled.

do $$
declare
  plan_row record;
  allocation_row record;
  normalized_sources jsonb;
  transaction_row record;
begin
  for plan_row in
    select *
    from public.extra_payments payment
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(payment.sources, '[]'::jsonb)) source
      where coalesce((source ->> 'pendingBalanceApply')::boolean, false)
    )
  loop
    for allocation_row in
      select
        item ->> 'billId' as bill_id,
        coalesce((item ->> 'payment')::numeric, 0) as payment
      from jsonb_array_elements(coalesce(plan_row.allocations, '[]'::jsonb)) item
      where coalesce((item ->> 'payment')::numeric, 0) > 0
    loop
      update public.bills
      set balance = round(balance + allocation_row.payment, 2)
      where id = allocation_row.bill_id
        and is_debt;

      update public.monthly_overrides
      set paid_amount = greatest(0, paid_amount - allocation_row.payment)
      where bill_id = allocation_row.bill_id
        and month = plan_row.month
        and year = plan_row.year;
    end loop;

    select coalesce(
      jsonb_agg(source || jsonb_build_object('pendingBalanceApply', true)),
      '[]'::jsonb
    )
    into normalized_sources
    from jsonb_array_elements(coalesce(plan_row.sources, '[]'::jsonb)) source;

    if jsonb_array_length(normalized_sources) = 0 then
      normalized_sources := jsonb_build_array(jsonb_build_object(
        'type', 'manual',
        'amount', plan_row.amount,
        'pendingBalanceApply', true
      ));
    end if;

    update public.extra_payments
    set sources = normalized_sources
    where id = plan_row.id;
  end loop;

  for transaction_row in
    select *
    from public.transactions
    where coalesce(import_hash, '') like 'flowledger:debt-surplus:%'
      and deleted_at is null
      and removed_at is null
  loop
    if transaction_row.debt_applied_bill_id is not null
      and coalesce(transaction_row.debt_applied_amount, 0) > 0 then
      update public.bills
      set balance = round(balance + transaction_row.debt_applied_amount, 2)
      where id = transaction_row.debt_applied_bill_id
        and is_debt;
    end if;

    update public.transactions
    set source = 'snowball_plan',
        debt_applied_amount = 0,
        debt_applied_bill_id = null
    where id = transaction_row.id;
  end loop;
end;
$$;

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

  select id, allocations, sources
  into v_existing_id, v_old_allocations, v_old_sources
  from public.extra_payments
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
      select item ->> 'billId' as bill_id, 0::numeric as delta
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
    set amount = p_amount,
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

create or replace function public.sync_due_debt_transactions(
  p_as_of_date date,
  p_household_id uuid default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_tx record;
  v_desired numeric;
  v_current numeric;
  v_balance numeric;
  v_allocated_to_debt numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_household_id is not null and not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;

  for v_tx in
    select *
    from public.transactions
    where (linked_bill_id is not null or debt_applied_bill_id is not null or debt_applied_amount > 0)
      and deleted_at is null
      and removed_at is null
      and not coalesce(pending, false)
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      )
    for update
  loop
    if v_tx.debt_applied_bill_id is not null
      and v_tx.debt_applied_bill_id is distinct from v_tx.linked_bill_id
      and v_tx.debt_applied_amount > 0 then
      update public.bills
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

    select sum(coalesce((allocation ->> 'amount')::numeric, 0))
    into v_allocated_to_debt
    from jsonb_array_elements(coalesce(v_tx.review_allocations, '[]'::jsonb)) allocation
    where allocation ->> 'type' in ('bill', 'extra_principal');

    v_desired := case
      when v_tx.linked_bill_id is not null
        and coalesce(v_tx.source, '') <> 'snowball_plan'
        and v_tx.amount < 0
        and v_tx.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and v_tx.date::date <= p_as_of_date
        then coalesce(v_allocated_to_debt, abs(v_tx.amount))
      else 0
    end;
    v_current := case
      when v_tx.debt_applied_bill_id = v_tx.linked_bill_id
        then coalesce(v_tx.debt_applied_amount, 0)
      else 0
    end;

    if v_tx.linked_bill_id is not null and v_desired > 0 then
      v_balance := null;
      select balance into v_balance
      from public.bills
      where id = v_tx.linked_bill_id
        and is_debt
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        )
      for update;
      if v_balance is null then
        update public.transactions
        set linked_bill_id = null,
            debt_applied_amount = 0,
            debt_applied_bill_id = null
        where id = v_tx.id;
        continue;
      end if;
      v_desired := least(v_desired, v_balance + v_current);
    end if;

    if v_tx.linked_bill_id is not null and abs(v_desired - v_current) >= 0.005 then
      update public.bills
      set balance = greatest(0, balance - (v_desired - v_current))
      where id = v_tx.linked_bill_id
        and is_debt
        and (
          (p_household_id is not null and household_id = p_household_id) or
          (p_household_id is null and user_id = v_user_id)
        );
      if not found then
        update public.transactions
        set linked_bill_id = null,
            debt_applied_amount = 0,
            debt_applied_bill_id = null
        where id = v_tx.id;
        continue;
      end if;
    end if;

    update public.transactions
    set debt_applied_amount = v_desired,
        debt_applied_bill_id = case when v_desired > 0 then v_tx.linked_bill_id else null end
    where id = v_tx.id
      and (
        (p_household_id is not null and household_id = p_household_id) or
        (p_household_id is null and user_id = v_user_id)
      );
  end loop;

  perform public.recalculate_debt_minimum_boosts(p_household_id);
end;
$$;

notify pgrst, 'reload schema';
