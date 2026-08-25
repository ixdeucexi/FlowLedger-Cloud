-- A monthly bill occurrence must have one canonical override row. Without this
-- boundary, a client edit and an atomic reconciliation can both create a row
-- for the same occurrence and later reads can disagree about which row is paid.
do $$
begin
  if exists (
    select 1
    from public.monthly_overrides
    where household_id is null
    limit 1
  ) then
    raise exception 'monthly_overrides contains rows without a household; backfill them before enforcing occurrence uniqueness';
  end if;

  if exists (
    select 1
    from public.monthly_overrides
    group by household_id, bill_id, month, year
    having count(*) > 1
    limit 1
  ) then
    raise exception 'monthly_overrides contains duplicate household bill occurrences; resolve them before enforcing uniqueness';
  end if;
end
$$;

-- The original household FK used ON DELETE SET NULL. Once occurrences are
-- household-required, deletion must remove them instead of violating NOT NULL.
alter table public.monthly_overrides
  drop constraint if exists monthly_overrides_household_id_fkey;
alter table public.monthly_overrides
  add constraint monthly_overrides_household_id_fkey
  foreign key (household_id) references public.households(id) on delete cascade;

alter table public.monthly_overrides
  alter column household_id set not null;

create unique index if not exists monthly_overrides_household_bill_occurrence_uidx
  on public.monthly_overrides (household_id, bill_id, month, year);

-- Persist a bill edit and every base-change preservation/reset as one database
-- transaction. Expected values make a delayed retry safe: a field may still be
-- at its open-time value or already at the requested value, but a third value
-- is a real concurrent edit and fails closed.
create or replace function public.update_bill_with_override_intents(
  p_bill_id text,
  p_expected jsonb,
  p_patch jsonb,
  p_overrides jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_bill public.bills%rowtype;
  v_was_debt boolean;
  v_key text;
  v_intent jsonb;
  v_override_patch jsonb;
  v_override_expected jsonb;
  v_override public.monthly_overrides%rowtype;
  v_saved_overrides jsonb := '[]'::jsonb;
  v_debt_minimums jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if p_bill_id is null or p_bill_id = '' then
    raise exception 'Bill id is required';
  end if;
  if jsonb_typeof(coalesce(p_expected, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'Invalid bill edit payload';
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if not (v_key = any (array[
      'name', 'amount', 'category', 'priority', 'is_debt', 'balance',
      'interest_rate', 'due_day', 'day_of_week', 'next_payment_date',
      'start_date', 'end_date', 'is_recurring', 'frequency',
      'smart_priority', 'include_in_snowball'
    ])) then
      raise exception 'Unsupported bill edit field: %', v_key;
    end if;
    if not coalesce(p_expected, '{}'::jsonb) ? v_key then
      raise exception 'Missing expected value for bill field: %', v_key;
    end if;
  end loop;

  select * into v_bill
  from public.bills
  where id = p_bill_id
  for update;
  if not found then
    raise exception 'Bill not found or edit access changed';
  end if;
  if v_bill.household_id is null
     or not public.is_household_editor(v_bill.household_id) then
    raise exception 'Household edit access required';
  end if;

  -- Permit the original expected value (first attempt) or the requested value
  -- (a retry after a committed response was lost). Anything else is a conflict.
  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if (to_jsonb(v_bill) -> v_key) is distinct from (p_expected -> v_key)
       and (to_jsonb(v_bill) -> v_key) is distinct from (p_patch -> v_key) then
      raise exception using
        errcode = '40001',
        message = format('Bill changed while editing field %s; refresh and try again', v_key);
    end if;
  end loop;

  v_was_debt := v_bill.is_debt;
  update public.bills set
    name = case when p_patch ? 'name' then p_patch ->> 'name' else name end,
    amount = case when p_patch ? 'amount' then (p_patch ->> 'amount')::numeric else amount end,
    category = case when p_patch ? 'category' then p_patch ->> 'category' else category end,
    priority = case when p_patch ? 'priority' then (p_patch ->> 'priority')::integer else priority end,
    is_debt = case when p_patch ? 'is_debt' then (p_patch ->> 'is_debt')::boolean else is_debt end,
    balance = case when p_patch ? 'balance' then (p_patch ->> 'balance')::numeric else balance end,
    interest_rate = case when p_patch ? 'interest_rate' then (p_patch ->> 'interest_rate')::numeric else interest_rate end,
    due_day = case when p_patch ? 'due_day' then (p_patch ->> 'due_day')::integer else due_day end,
    day_of_week = case when p_patch ? 'day_of_week' then (p_patch ->> 'day_of_week')::integer else day_of_week end,
    next_payment_date = case when p_patch ? 'next_payment_date' then p_patch ->> 'next_payment_date' else next_payment_date end,
    start_date = case when p_patch ? 'start_date' then p_patch ->> 'start_date' else start_date end,
    end_date = case when p_patch ? 'end_date' then p_patch ->> 'end_date' else end_date end,
    is_recurring = case when p_patch ? 'is_recurring' then (p_patch ->> 'is_recurring')::boolean else is_recurring end,
    frequency = case when p_patch ? 'frequency' then p_patch ->> 'frequency' else frequency end,
    smart_priority = case when p_patch ? 'smart_priority' then p_patch ->> 'smart_priority' else smart_priority end,
    include_in_snowball = case when p_patch ? 'include_in_snowball' then (p_patch ->> 'include_in_snowball')::boolean else include_in_snowball end,
    last_reviewed_at = now()
  where id = p_bill_id
  returning * into v_bill;

  for v_intent in select value from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    if jsonb_typeof(v_intent) <> 'object'
       or jsonb_typeof(coalesce(v_intent -> 'patch', '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(v_intent -> 'expected', '{}'::jsonb)) <> 'object' then
      raise exception 'Invalid monthly override intent';
    end if;
    v_override_patch := coalesce(v_intent -> 'patch', '{}'::jsonb);
    v_override_expected := coalesce(v_intent -> 'expected', '{}'::jsonb);
    for v_key in select jsonb_object_keys(v_override_patch) loop
      if not (v_key = any (array['custom_amount', 'custom_due_day'])) then
        raise exception 'Unsupported monthly override field: %', v_key;
      end if;
      if not v_override_expected ? v_key then
        raise exception 'Missing expected monthly override field: %', v_key;
      end if;
    end loop;
    if (v_intent ->> 'id') is null
       or (v_intent ->> 'month') is null
       or (v_intent ->> 'year') is null
       or (v_intent ->> 'month')::integer not between 0 and 11
       or (v_intent ->> 'year')::integer not between 2000 and 2200 then
      raise exception 'Invalid monthly override identity';
    end if;

    insert into public.monthly_overrides (
      id, user_id, household_id, budget_id, bill_id, month, year,
      custom_amount, custom_due_day
    ) values (
      v_intent ->> 'id', v_actor, v_bill.household_id, v_bill.budget_id,
      v_bill.id, (v_intent ->> 'month')::integer, (v_intent ->> 'year')::integer,
      case when v_override_patch ? 'custom_amount' then (v_override_patch ->> 'custom_amount')::numeric else null end,
      case when v_override_patch ? 'custom_due_day' then (v_override_patch ->> 'custom_due_day')::integer else null end
    )
    on conflict (household_id, bill_id, month, year) do nothing;

    select * into v_override
    from public.monthly_overrides
    where household_id = v_bill.household_id
      and bill_id = v_bill.id
      and month = (v_intent ->> 'month')::integer
      and year = (v_intent ->> 'year')::integer
    for update;
    if not found then
      raise exception 'Monthly override could not be saved';
    end if;
    for v_key in select jsonb_object_keys(v_override_patch) loop
      if (to_jsonb(v_override) -> v_key) is distinct from (v_override_expected -> v_key)
         and (to_jsonb(v_override) -> v_key) is distinct from (v_override_patch -> v_key) then
        raise exception using
          errcode = '40001',
          message = format('Monthly override changed while editing field %s; refresh and try again', v_key);
      end if;
    end loop;

    update public.monthly_overrides set
      custom_amount = case
        when v_override_patch ? 'custom_amount' then (v_override_patch ->> 'custom_amount')::numeric
        else custom_amount
      end,
      custom_due_day = case
        when v_override_patch ? 'custom_due_day' then (v_override_patch ->> 'custom_due_day')::integer
        else custom_due_day
      end
    where id = v_override.id
    returning * into v_override;
    v_saved_overrides := v_saved_overrides || jsonb_build_array(to_jsonb(v_override));
  end loop;

  if (v_was_debt or v_bill.is_debt)
     and p_patch ?| array['amount', 'balance', 'is_debt', 'include_in_snowball'] then
    perform public.recalculate_debt_minimum_boosts(v_bill.household_id);
    select * into v_bill from public.bills where id = p_bill_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', debt.id,
      'snowball_minimum_boost', debt.snowball_minimum_boost
    )), '[]'::jsonb)
    into v_debt_minimums
    from public.bills debt
    where debt.household_id = v_bill.household_id and debt.is_debt;
  end if;

  return jsonb_build_object(
    'bill', to_jsonb(v_bill),
    'overrides', v_saved_overrides,
    'debt_minimums', v_debt_minimums
  );
end;
$$;

revoke all on function public.update_bill_with_override_intents(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_bill_with_override_intents(text, jsonb, jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
