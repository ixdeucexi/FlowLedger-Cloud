alter table bills add column if not exists include_in_snowball boolean not null default true;

alter table monthly_overrides add column if not exists actual_amount numeric;
alter table monthly_overrides add column if not exists paid_date date;

alter table extra_payments add column if not exists payment_date date;
alter table extra_payments add column if not exists sources jsonb not null default '[]'::jsonb;

update extra_payments
set payment_date = make_date(year, month + 1, 1)
where payment_date is null;

update extra_payments
set sources = jsonb_build_array(jsonb_build_object('type', 'manual', 'amount', amount))
where sources = '[]'::jsonb;

create unique index if not exists extra_payments_user_month_year_idx
  on extra_payments(user_id, year, month);

create or replace function apply_debt_snowball_payment(
  p_payment_id text,
  p_month integer,
  p_year integer,
  p_amount numeric,
  p_payment_date date,
  p_allocations jsonb,
  p_sources jsonb
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
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select id, allocations
    into v_existing_id, v_old_allocations
  from extra_payments
  where user_id = v_user_id and month = p_month and year = p_year
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
    where id = v_change.bill_id and user_id = v_user_id;
    if not found then
      raise exception 'Debt % was not found', v_change.bill_id;
    end if;

    select id into v_override_id
    from monthly_overrides
    where user_id = v_user_id and bill_id = v_change.bill_id
      and month = p_month and year = p_year
    limit 1
    for update;

    if v_override_id is null then
      insert into monthly_overrides (id, user_id, bill_id, month, year, paid_amount)
      values (gen_random_uuid()::text, v_user_id, v_change.bill_id, p_month, p_year, greatest(0, v_change.delta));
    else
      update monthly_overrides
        set paid_amount = greatest(0, paid_amount + v_change.delta)
      where id = v_override_id and user_id = v_user_id;
    end if;
    v_override_id := null;
  end loop;

  v_payment_id := coalesce(v_existing_id, p_payment_id, gen_random_uuid()::text);
  insert into extra_payments (id, user_id, month, year, amount, allocations, payment_date, sources)
  values (v_payment_id, v_user_id, p_month, p_year, p_amount, coalesce(p_allocations, '[]'::jsonb), p_payment_date, coalesce(p_sources, '[]'::jsonb))
  on conflict (user_id, year, month) do update set
    amount = excluded.amount,
    allocations = excluded.allocations,
    payment_date = excluded.payment_date,
    sources = excluded.sources
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

create or replace function remove_debt_snowball_payment(
  p_month integer,
  p_year integer
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
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select id, allocations into v_payment_id, v_allocations
  from extra_payments
  where user_id = v_user_id and month = p_month and year = p_year
  for update;

  if v_payment_id is null then return; end if;

  for v_item in select * from jsonb_array_elements(coalesce(v_allocations, '[]'::jsonb))
  loop
    v_bill_id := v_item ->> 'billId';
    v_payment := (v_item ->> 'payment')::numeric;
    update bills set balance = balance + v_payment
    where id = v_bill_id and user_id = v_user_id;

    select id into v_override_id
    from monthly_overrides
    where user_id = v_user_id and bill_id = v_bill_id
      and month = p_month and year = p_year
    limit 1
    for update;
    if v_override_id is not null then
      update monthly_overrides
        set paid_amount = greatest(0, paid_amount - v_payment)
      where id = v_override_id and user_id = v_user_id;
    end if;
    v_override_id := null;
  end loop;

  delete from extra_payments where id = v_payment_id and user_id = v_user_id;
end;
$$;
