-- Serialize household settings by scope and update only fields owned by one
-- intent. Account creation, its opening balance, and the forecast anchor share
-- the same transaction and advisory lock.

create or replace function public.update_household_settings_patch(
  p_household_id uuid,
  p_budget_id uuid,
  p_expected jsonb,
  p_patch jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_row public.household_settings%rowtype;
  v_key text;
  v_debt_minimums jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_household_id is null or not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if not exists (
    select 1 from public.budgets
    where id = p_budget_id and household_id = p_household_id
  ) then
    raise exception 'The active household budget changed';
  end if;
  if jsonb_typeof(coalesce(p_expected, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid settings patch';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if not (v_key = any (array[
      'zero_based_budget_enabled', 'debt_payoff_enabled', 'payment_method',
      'starting_balance', 'starting_balance_date', 'calendar_start_date',
      'safety_floor', 'forecast_horizon_months', 'onboarding_completed'
    ])) then
      raise exception 'Unsupported settings field: %', v_key;
    end if;
    if not coalesce(p_expected, '{}'::jsonb) ? v_key then
      raise exception 'Missing expected settings field: %', v_key;
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('flowledger-settings:' || p_household_id::text, 0));
  insert into public.household_settings (household_id, budget_id)
  values (p_household_id, p_budget_id)
  on conflict (household_id) do nothing;

  select * into v_row
  from public.household_settings
  where household_id = p_household_id
  for update;
  if not found then raise exception 'Household settings could not be initialized'; end if;

  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if (to_jsonb(v_row) -> v_key) is distinct from (p_expected -> v_key)
       and (to_jsonb(v_row) -> v_key) is distinct from (p_patch -> v_key) then
      raise exception using
        errcode = '40001',
        message = format('Settings changed while editing field %s; refresh and try again', v_key);
    end if;
  end loop;

  update public.household_settings set
    budget_id = p_budget_id,
    zero_based_budget_enabled = case when p_patch ? 'zero_based_budget_enabled' then (p_patch ->> 'zero_based_budget_enabled')::boolean else zero_based_budget_enabled end,
    debt_payoff_enabled = case when p_patch ? 'debt_payoff_enabled' then (p_patch ->> 'debt_payoff_enabled')::boolean else debt_payoff_enabled end,
    payment_method = case when p_patch ? 'payment_method' then p_patch ->> 'payment_method' else payment_method end,
    starting_balance = case when p_patch ? 'starting_balance' then (p_patch ->> 'starting_balance')::numeric else starting_balance end,
    starting_balance_date = case when p_patch ? 'starting_balance_date' then p_patch ->> 'starting_balance_date' else starting_balance_date end,
    calendar_start_date = case when p_patch ? 'calendar_start_date' then p_patch ->> 'calendar_start_date' else calendar_start_date end,
    safety_floor = case when p_patch ? 'safety_floor' then (p_patch ->> 'safety_floor')::numeric else safety_floor end,
    forecast_horizon_months = case when p_patch ? 'forecast_horizon_months' then (p_patch ->> 'forecast_horizon_months')::integer else forecast_horizon_months end,
    onboarding_completed = case when p_patch ? 'onboarding_completed' then (p_patch ->> 'onboarding_completed')::boolean else onboarding_completed end,
    updated_at = now()
  where household_id = p_household_id
  returning * into v_row;

  if p_patch ? 'payment_method' then
    perform public.recalculate_debt_minimum_boosts(p_household_id);
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', debt.id,
      'snowball_minimum_boost', debt.snowball_minimum_boost
    )), '[]'::jsonb)
    into v_debt_minimums
    from public.bills debt
    where debt.household_id = p_household_id and debt.is_debt;
  end if;

  return jsonb_build_object('settings', to_jsonb(v_row), 'debt_minimums', v_debt_minimums);
end;
$$;

create or replace function public.add_manual_account_with_anchor(
  p_household_id uuid,
  p_budget_id uuid,
  p_account jsonb,
  p_balance_id text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_account public.accounts%rowtype;
  v_settings public.household_settings%rowtype;
  v_anchor_balance numeric;
  v_anchor_date date;
  v_inserted_count integer := 0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_household_id is null or not public.is_household_editor(p_household_id) then
    raise exception 'Household edit access required';
  end if;
  if not exists (
    select 1 from public.budgets
    where id = p_budget_id and household_id = p_household_id
  ) then
    raise exception 'The active household budget changed';
  end if;
  if jsonb_typeof(coalesce(p_account, '{}'::jsonb)) <> 'object'
     or coalesce(p_account ->> 'id', '') = ''
     or coalesce(p_balance_id, '') = '' then
    raise exception 'Invalid account creation intent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('flowledger-settings:' || p_household_id::text, 0));
  insert into public.accounts (
    id, user_id, household_id, budget_id, name, account_type,
    current_balance, balance_as_of, last_reconciled_at, is_active, created_at
  ) values (
    p_account ->> 'id', v_actor, p_household_id, p_budget_id,
    p_account ->> 'name', p_account ->> 'account_type',
    (p_account ->> 'current_balance')::numeric,
    (p_account ->> 'balance_as_of')::date,
    (p_account ->> 'last_reconciled_at')::timestamptz,
    coalesce((p_account ->> 'is_active')::boolean, true),
    coalesce((p_account ->> 'created_at')::timestamptz, now())
  ) on conflict (id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_account from public.accounts where id = p_account ->> 'id' for update;
  if not found or v_account.household_id is distinct from p_household_id then
    raise exception 'Account id is already in use';
  end if;
  if v_inserted_count = 0 and (
    v_account.user_id is distinct from v_actor
    or v_account.budget_id is distinct from p_budget_id
    or v_account.name is distinct from (p_account ->> 'name')
    or v_account.account_type is distinct from (p_account ->> 'account_type')
    or v_account.current_balance is distinct from (p_account ->> 'current_balance')::numeric
    or v_account.balance_as_of is distinct from (p_account ->> 'balance_as_of')::date
    or v_account.last_reconciled_at is distinct from (p_account ->> 'last_reconciled_at')::timestamptz
    or v_account.is_active is distinct from coalesce((p_account ->> 'is_active')::boolean, true)
  ) then
    raise exception using
      errcode = '40001',
      message = 'Account creation id is already bound to a different intent';
  end if;

  insert into public.household_settings (household_id, budget_id)
  values (p_household_id, p_budget_id)
  on conflict (household_id) do nothing;

  if v_inserted_count > 0 then
    insert into public.account_balances (
      id, account_id, user_id, household_id, budget_id, balance, as_of_date, source
    ) values (
      p_balance_id, v_account.id, v_actor, p_household_id, p_budget_id,
      (p_account ->> 'current_balance')::numeric,
      (p_account ->> 'balance_as_of')::date,
      'manual'
    );

    select sum(account.current_balance), max(account.balance_as_of)
    into v_anchor_balance, v_anchor_date
    from public.accounts account
    where account.household_id = p_household_id
      and account.is_active
      and account.account_type in ('checking', 'cash');

    if v_anchor_date is not null then
      update public.household_settings set
        budget_id = p_budget_id,
        starting_balance = coalesce(v_anchor_balance, 0),
        starting_balance_date = v_anchor_date::text,
        calendar_start_date = coalesce(calendar_start_date, to_char(v_anchor_date, 'YYYY-MM-01')),
        updated_at = now()
      where household_id = p_household_id;
    end if;
  end if;

  select * into v_settings
  from public.household_settings
  where household_id = p_household_id;
  return jsonb_build_object('account', to_jsonb(v_account), 'settings', to_jsonb(v_settings));
end;
$$;

revoke all on function public.update_household_settings_patch(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.add_manual_account_with_anchor(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.update_household_settings_patch(uuid, uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.add_manual_account_with_anchor(uuid, uuid, jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
